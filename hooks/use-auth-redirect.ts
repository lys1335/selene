"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";

export function useAuthRedirect(options: { redirectOnNoUsers?: boolean } = {}) {
  const { user, isLoading, noUsers } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;
    if (user) router.replace("/");
  }, [isLoading, user, router]);

  return { checkingAuth: isLoading, isFirstUser: noUsers };
}
