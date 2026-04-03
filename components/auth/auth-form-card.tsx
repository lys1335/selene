"use client";

import { AlertCircleIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";

interface AuthFormCardProps {
    title: string;
    subtitle: string;
    /** Banner rendered above the form (e.g. first-user notice) */
    banner?: React.ReactNode;
    email: string;
    onEmailChange: (value: string) => void;
    password: string;
    onPasswordChange: (value: string) => void;
    /** Extra fields inserted after the password field */
    extraFields?: React.ReactNode;
    /** Hint rendered below the password input */
    passwordHint?: string;
    submitLabel: string;
    submittingLabel: string;
    loading: boolean;
    error: string;
    onSubmit: (e: React.FormEvent) => void;
    /** Footer content (e.g. "already have an account?" link) */
    footer?: React.ReactNode;
    emailPlaceholder: string;
    passwordPlaceholder: string;
}

export function AuthFormCard({
    title,
    subtitle,
    banner,
    email,
    onEmailChange,
    password,
    onPasswordChange,
    extraFields,
    passwordHint,
    submitLabel,
    submittingLabel,
    loading,
    error,
    onSubmit,
    footer,
    emailPlaceholder,
    passwordPlaceholder,
}: AuthFormCardProps) {
    const tc = useTranslations("common");

    return (
        <div className="space-y-6">
            <div className="text-center">
                <h1 className="text-2xl font-bold tracking-tight font-mono text-terminal-dark">
                    {title}
                </h1>
                <p className="mt-2 text-sm text-terminal-muted font-mono">
                    {subtitle}
                </p>
            </div>

            {banner}

            <form onSubmit={onSubmit} className="space-y-4">
                {error && (
                    <div className="flex items-center gap-2 p-3 text-sm text-red-600 bg-red-50 rounded-md border border-red-200">
                        <AlertCircleIcon className="size-4 flex-shrink-0" />
                        <span className="font-mono">{error}</span>
                    </div>
                )}

                <div className="space-y-2">
                    <Label htmlFor="email" className="font-mono text-terminal-dark">
                        {tc("email")}
                    </Label>
                    <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => onEmailChange(e.target.value)}
                        placeholder={emailPlaceholder}
                        required
                        disabled={loading}
                        className="font-mono bg-terminal-cream border-terminal-border focus:border-terminal-green focus:ring-terminal-green"
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="password" className="font-mono text-terminal-dark">
                        {tc("password")}
                    </Label>
                    <Input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(e) => onPasswordChange(e.target.value)}
                        placeholder={passwordPlaceholder}
                        required
                        disabled={loading}
                        className="font-mono bg-terminal-cream border-terminal-border focus:border-terminal-green focus:ring-terminal-green"
                    />
                    {passwordHint && (
                        <p className="text-xs text-terminal-muted font-mono">{passwordHint}</p>
                    )}
                </div>

                {extraFields}

                <Button
                    type="submit"
                    disabled={loading}
                    className="w-full font-mono bg-terminal-green hover:bg-terminal-green/90 text-terminal-cream"
                >
                    {loading ? (
                        <>
                            <Loader2Icon className="mr-2 size-4 animate-spin" />
                            {submittingLabel}
                        </>
                    ) : (
                        submitLabel
                    )}
                </Button>
            </form>

            {footer}
        </div>
    );
}
