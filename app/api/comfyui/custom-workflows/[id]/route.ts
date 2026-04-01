import { NextRequest, NextResponse } from "next/server";
import { analyzeWorkflow } from "@/lib/comfyui/custom/analyzer";
import { fetchObjectInfo, resolveCustomComfyUIBaseUrl } from "@/lib/comfyui/custom/client";
import {
  deleteCustomComfyUIWorkflow,
  getCustomComfyUIWorkflow,
  saveCustomComfyUIWorkflow,
} from "@/lib/comfyui/custom/store";
import type { CustomComfyUIWorkflow } from "@/lib/comfyui/custom/types";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const workflow = await getCustomComfyUIWorkflow(id);
  if (!workflow) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }
  return NextResponse.json({ workflow });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await getCustomComfyUIWorkflow(id);
    if (!existing) {
      return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
    }

    const body = (await request.json()) as Partial<CustomComfyUIWorkflow> & {
      workflow?: Record<string, unknown> | string;
      validateWithComfyUI?: boolean;
    };
    const workflowJson =
      typeof body.workflow === "string"
        ? JSON.parse(body.workflow)
        : body.workflow || existing.workflow;
    let objectInfo: Record<string, unknown> | undefined;
    if (body.validateWithComfyUI) {
      // Use explicit property presence: if the field is in the body (even as empty/undefined),
      // respect it as "cleared override" instead of falling back to the existing value.
      const resolved = await resolveCustomComfyUIBaseUrl({
        comfyuiBaseUrl: "comfyuiBaseUrl" in body ? body.comfyuiBaseUrl : existing.comfyuiBaseUrl,
        comfyuiHost: "comfyuiHost" in body ? body.comfyuiHost : existing.comfyuiHost,
        comfyuiPort: "comfyuiPort" in body ? body.comfyuiPort : existing.comfyuiPort,
      });
      objectInfo = await fetchObjectInfo(resolved.baseUrl);
    }

    const analysis = analyzeWorkflow(
      workflowJson as Record<string, unknown>,
      body.format || existing.format,
      { objectInfo }
    );

    const updated: CustomComfyUIWorkflow = {
      ...existing,
      ...body,
      workflow: workflowJson as Record<string, unknown>,
      format: body.format || analysis.format,
      inputs: body.inputs && body.inputs.length > 0 ? body.inputs : existing.inputs || analysis.inputs,
      outputs: body.outputs && body.outputs.length > 0 ? body.outputs : existing.outputs || analysis.outputs,
      updatedAt: new Date().toISOString(),
    };

    const saved = await saveCustomComfyUIWorkflow(updated);
    return NextResponse.json({ workflow: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to update workflow";
    const isConnectionError =
      typeof message === "string" &&
      (message.includes("ComfyUI connection failed") ||
        message.includes("ComfyUI instance not reachable"));
    return NextResponse.json(
      { error: message },
      { status: isConnectionError ? 503 : 500 }
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const deleted = await deleteCustomComfyUIWorkflow(id);
  if (!deleted) {
    return NextResponse.json({ error: "Workflow not found" }, { status: 404 });
  }
  return NextResponse.json({ status: "deleted" });
}
