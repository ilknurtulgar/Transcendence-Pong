import { apiUrl } from "./api";

export type AuthState =
    | "GUEST"
    | "NEEDS_2FA_VERIFY"
    | "AUTHENTICATED";

export class AuthService {
    private static API_URL = apiUrl("/api/users");

    static async getAuthState(): Promise<AuthState> {
        try {
            const response = await fetch(`${this.API_URL}/me`, {
                method: "GET",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json"
                }
            });

            if (!response.ok)
                return "GUEST";

            const data = await response.json();

            if (data.authenticated === false)
                return "GUEST";

            if (data.twoFAEnabled && data.twoFANeedsVerify)
                return "NEEDS_2FA_VERIFY";

            return "AUTHENTICATED";
        } catch {
            return "GUEST";
        }
    }

    static async login(alias: string, pass: string) {
        const response = await fetch(`${this.API_URL}/login`, {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                alias: alias,
                password: pass
            }),
        });

        const data = await response.json();

        if (data.success === false) {
            throw new Error(data.errorKey || "errors.generic");
        }

        return data;
    }

    static async register(alias: string, pass: string) {
        const response = await fetch(`${this.API_URL}/register`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ alias: alias, password: pass }),
        });

        const data = await response.json();

        if (data.success === false) {
            throw new Error(data.errorKey || "errors.generic");
        }
        return data;
    }

    static async logout() {
        try {
            const response = await fetch(`${this.API_URL}/logout`, {
                method: "POST",
                credentials: "include"
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.errorKey || errorData.error);
            }

            const data = await response.json();
            try {
                localStorage.setItem('auth:logout', String(Date.now()))
            } catch {

            }
            try {
                window.dispatchEvent(new Event('auth:logout'))
            } catch {

            }

            return data;
        } catch (error) {
        }
    }
}