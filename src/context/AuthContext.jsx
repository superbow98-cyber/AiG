// AiG — Auth Context
// Global Google auth state — provides user object and signOut to all pages
// TODO: implement
import { createContext, useContext } from 'react';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);
export default AuthContext;
