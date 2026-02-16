import { apiUrl } from "./api";

export class TwoFAService {
    private static API_URL = apiUrl("/api/users/2fa");

    static async verify2FA(code: string) {
        const response = await fetch(`${this.API_URL}/verify-login`, {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ token: code })
        });

        const data = await response.json();

        if (data.success === false) {
            throw new Error(data.errorKey || "errors.generic");
        }
        return data;
    }

    static async setup2FA() {
        const response = await fetch(`${this.API_URL}/setup`, {
            method: "POST",
            credentials: "include"
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(errorData.errorKey || errorData.error || "Setup failed");
        }
        return await response.json();
    }

    static async enable2FA(code: string) {
        const response = await fetch(`${this.API_URL}/enable`, {
            method: "POST",
            credentials: "include",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ token: code })
        });

        const data = await response.json();

        if (data.success === false) {
            throw new Error(data.errorKey || "errors.generic");
        }
        return data;
    }
}