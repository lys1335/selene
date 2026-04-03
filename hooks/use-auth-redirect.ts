"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface UseAuthRedirectOptions {
  /** If true, redirect to /signup when no users exist. If false, set isFirstUser instead. */
  redirectOnNoUsers?: boolean;
}

interface UseAuthRedirectResult {
  checkingAuth: boolean;
  isFirstUser: boolean;
}

/**
 * Checks /api/auth/verify on mount and handles the common auth redirect pattern:
 * - If already authenticated → redirect to /
 * - If no users exist → either redirect to /signup (login page) or surface isFirstUser flag (signup page)
 */
export function useAuthRedirect(
  options: UseAuthRedirectOptions = {}
): UseAuthRedirectResult {
  const { redirectOnNoUsers = false } = options;
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [isFirstUser, setIsFirstUser] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch("/api/auth/verify");
        const data = await res.json();

        if (data.authenticated) {
          router.replace("/");
        } else if (data.noUsers) {
          if (redirectOnNoUsers) {
            router.replace("/signup");
          } else {
            setIsFirstUser(true);
          }
        }
      } catch {
        // Ignore errors, just show the form
      } finally {
        setCheckingAuth(false);
      }
    };

    checkAuth();
  }, [router, redirectOnNoUsers]);

  return { checkingAuth, isFirstUser };
}
