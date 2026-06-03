import { createContext, useCallback, useContext, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";

const NavigationGuardContext = createContext({
  registerGuard: () => () => {},
  requestNavigation: () => {},
});

export function NavigationGuardProvider({ children }) {
  const navigate = useNavigate();
  const guardRef = useRef(null);

  const registerGuard = useCallback((guard) => {
    guardRef.current = guard;
    return () => {
      if (guardRef.current === guard) {
        guardRef.current = null;
      }
    };
  }, []);

  const requestNavigation = useCallback(
    async (to, options) => {
      if (guardRef.current) {
        const canLeave = await guardRef.current(to);
        if (!canLeave) return;
      }
      navigate(to, options);
    },
    [navigate],
  );

  const value = useMemo(() => ({ registerGuard, requestNavigation }), [registerGuard, requestNavigation]);

  return <NavigationGuardContext.Provider value={value}>{children}</NavigationGuardContext.Provider>;
}

export const useNavigationGuard = () => useContext(NavigationGuardContext);
