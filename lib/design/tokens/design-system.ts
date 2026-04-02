/**
 * Design tokens extracted from the Otter Cards prompt library.
 *
 * These are the hardcoded design values embedded in the AI system prompts.
 * They define the visual language that the AI models are trained to follow
 * when generating card designs.
 */

import type { DesignToken } from '../types';

export const DESIGN_SYSTEM: Record<string, DesignToken[]> = {
  /**
   * Apple Liquid Glass material properties.
   * Source: apple-glass-prompt.ts
   */
  glass: [
    {
      name: 'glass-blur',
      value: '24px',
      category: 'border',
      description: 'Primary backdrop-filter blur radius for glass effect',
    },
    {
      name: 'glass-saturation',
      value: '180%',
      category: 'color',
      description: 'Backdrop-filter saturate value for glass vibrancy',
    },
    {
      name: 'glass-background',
      value: 'rgba(255, 255, 255, 0.05)',
      category: 'color',
      description: 'Semi-transparent glass background for light elements',
    },
    {
      name: 'glass-border',
      value: '1px solid rgba(255, 255, 255, 0.1)',
      category: 'border',
      description: 'Subtle glass border for edge definition',
    },
    {
      name: 'glass-border-radius',
      value: '20px',
      category: 'border',
      description: 'Default border-radius for glass panels',
    },
    {
      name: 'glass-shadow',
      value: '0 8px 32px 0 rgba(31, 38, 135, 0.15)',
      category: 'shadow',
      description: 'Standard glass panel box-shadow',
    },
  ],

  /**
   * Border-radius scale used across card layouts.
   * Sources: html-mode prompt, tailwind-mode prompt, apple-glass-prompt.
   */
  borderRadius: [
    {
      name: 'radius-card-standard',
      value: '16px',
      category: 'border',
      description: 'Standard card border-radius (centered card layout)',
    },
    {
      name: 'radius-card-immersive',
      value: '32px',
      category: 'border',
      description: 'Immersive / full-background card border-radius',
    },
    {
      name: 'radius-glass-panel',
      value: '20px',
      category: 'border',
      description: 'Apple Glass panel border-radius',
    },
    {
      name: 'radius-glass-range',
      value: '16-24px',
      category: 'border',
      description: 'Generous rounded corner range for glass visual hierarchy',
    },
  ],

  /**
   * Box-shadow scale.
   * Sources: html-mode prompt, apple-glass-prompt.
   */
  shadows: [
    {
      name: 'shadow-card-standard',
      value: '0 10px 40px rgba(0, 0, 0, 0.1)',
      category: 'shadow',
      description: 'Default card elevation shadow',
    },
    {
      name: 'shadow-glass',
      value: '0 8px 32px 0 rgba(31, 38, 135, 0.15)',
      category: 'shadow',
      description: 'Glass panel depth shadow (blue-tinted)',
    },
  ],

  /**
   * Spacing tokens from layout requirements.
   * Sources: html-mode prompt, tailwind-mode prompt.
   */
  spacing: [
    {
      name: 'spacing-card-padding',
      value: '32px',
      category: 'spacing',
      description: 'Standard inner card padding',
    },
    {
      name: 'spacing-container-padding',
      value: '20px',
      category: 'spacing',
      description: 'Outer container / preview padding',
    },
    {
      name: 'spacing-card-max-width-sm',
      value: '420px',
      category: 'spacing',
      description: 'Max width for immersive card layout',
    },
    {
      name: 'spacing-card-max-width-md',
      value: '500px',
      category: 'spacing',
      description: 'Max width for centered card layout',
    },
    {
      name: 'spacing-card-width',
      value: '90%',
      category: 'spacing',
      description: 'Responsive card width relative to container',
    },
  ],

  /**
   * Animation timing values.
   * Sources: apple-glass-prompt, animation prompt.
   */
  animation: [
    {
      name: 'ease-apple',
      value: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
      category: 'animation',
      description: "Apple's standard easing curve for glass transitions",
    },
    {
      name: 'duration-major',
      value: '0.4-0.6s',
      category: 'animation',
      description: 'Duration range for major transitions (page, modal)',
    },
    {
      name: 'duration-micro',
      value: '0.2-0.3s',
      category: 'animation',
      description: 'Duration range for micro-interactions (hover, tap)',
    },
    {
      name: 'duration-cursor-move',
      value: '0.8s',
      category: 'animation',
      description: 'Mouse cursor movement transition duration',
    },
    {
      name: 'duration-ripple',
      value: '0.6s',
      category: 'animation',
      description: 'Click ripple effect duration',
    },
    {
      name: 'spring-stiffness-range',
      value: '100-500',
      category: 'animation',
      description: 'Spring stiffness range for organic feel',
    },
    {
      name: 'spring-damping-range',
      value: '10-30',
      category: 'animation',
      description: 'Spring damping range for organic feel',
    },
    {
      name: 'scale-hover',
      value: 1.02,
      category: 'animation',
      description: 'Subtle scale factor on hover (glass elements)',
    },
    {
      name: 'scale-active',
      value: 0.98,
      category: 'animation',
      description: 'Scale factor on active/press state',
    },
    {
      name: 'scale-entrance',
      value: 0.95,
      category: 'animation',
      description: 'Initial scale for entrance animations (animates to 1)',
    },
    {
      name: 'blur-entrance',
      value: '4px',
      category: 'animation',
      description: 'Initial blur for entrance animations (animates to 0)',
    },
  ],

  /**
   * Color palette referenced in prompts.
   * Sources: html-mode prompt layout examples, glass prompt.
   */
  colors: [
    {
      name: 'color-bg-neutral',
      value: '#f8f9fa',
      category: 'color',
      description: 'Neutral background for centered card layout',
    },
    {
      name: 'color-bg-light-blue-start',
      value: '#f0f9ff',
      category: 'color',
      description: 'Light blue gradient start (example card container)',
    },
    {
      name: 'color-bg-light-blue-end',
      value: '#e0f2fe',
      category: 'color',
      description: 'Light blue gradient end (example card container)',
    },
    {
      name: 'color-glass-shadow-tint',
      value: 'rgba(31, 38, 135, 0.15)',
      category: 'color',
      description: 'Blue-tinted shadow color for glass panels',
    },
    {
      name: 'color-cursor-glow',
      value: 'radial-gradient(circle, rgba(255,255,255,1) 0%, rgba(255,255,255,0.8) 50%)',
      category: 'color',
      description: 'Animated cursor glow gradient',
    },
    {
      name: 'color-ripple-border',
      value: 'rgba(255, 255, 255, 0.8)',
      category: 'color',
      description: 'Click ripple border color',
    },
  ],

  /**
   * Typography tokens.
   * Sources: html-mode prompt example structure.
   */
  typography: [
    {
      name: 'font-system-stack',
      value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      category: 'typography',
      description: 'Default system font stack for card designs',
    },
  ],

  /**
   * Mouse cursor element sizing.
   * Sources: html-mode animation implementation.
   */
  cursor: [
    {
      name: 'cursor-size',
      value: '20px',
      category: 'spacing',
      description: 'Animated mouse cursor element width/height',
    },
    {
      name: 'cursor-ripple-size',
      value: '40px',
      category: 'spacing',
      description: 'Click ripple element width/height',
    },
    {
      name: 'cursor-z-index',
      value: 1000,
      category: 'spacing',
      description: 'Z-index for animated cursor overlay',
    },
  ],
};
