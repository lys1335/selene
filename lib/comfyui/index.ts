/**
 * ComfyUI Local Backend - Index
 * Re-exports all ComfyUI utilities
 */

export * from "./types";
export { generateImage, checkStatus } from "./client";

// FLUX.2 Klein exports
export {
    checkFlux2KleinHealth,
    generateFlux2KleinWithPolling,
} from "./flux2-klein-client";

export type {
    Flux2KleinVariant,
    Flux2KleinGenerateRequest,
    Flux2KleinGenerateResponse,
    Flux2KleinAsyncResponse,
    Flux2KleinJobStatusResponse,
    Flux2KleinHealthResponse,
} from "./flux2-klein-client";

