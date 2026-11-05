import { createContext, useContext } from 'react';
export const GuideContext = createContext(null);
export function useGuide() { return useContext(GuideContext); }
