import { useState, useCallback } from "react";

/**
 * Shared page transition variants for wizard components.
 * Slides pages in from the right on forward navigation, left on back.
 */
export const wizardPageVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? "100%" : "-100%",
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction < 0 ? "100%" : "-100%",
    opacity: 0,
  }),
};

/**
 * Manages step/page navigation direction for animated wizard transitions.
 * Returns `navigateTo` (sets current page + direction) and the current `direction`
 * value to pass as the `custom` prop to framer-motion.
 */
export function useWizardNavigation<T extends string>(initial: T) {
  const [currentPage, setCurrentPage] = useState<T>(initial);
  const [direction, setDirection] = useState(0);

  const navigateTo = useCallback((page: T, dir: number = 1) => {
    setDirection(dir);
    setCurrentPage(page);
  }, []);

  return { currentPage, direction, navigateTo };
}
