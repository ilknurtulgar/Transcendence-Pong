import { apiUrl } from "./api";
import { lang } from "../i18n/lang";

export class ProfileService {
    private static API_URL = apiUrl("/api/profiles");

    static async twoFaStatus() {

        try {
            const response = await fetch(`${this.API_URL}/me`, {
                credentials: "include"
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.errorKey || data.error);
            }
            return data;

        } catch (error) {
            alert(lang((error as Error).message) || (error as Error).message);
        }

    }

    static async profileData() {

        try {

            const response = await fetch(`${this.API_URL}/me`, {
                method: "GET",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json"
                }
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.errorKey || data.error);
            }

            return data;

        } catch (error) {
            alert(lang((error as Error).message) || (error as Error).message);
        }
    }
    static async updateProfile(alias: string, password?: string) {
        const response = await fetch(`${this.API_URL}/me`, {
            method: "PUT",
            credentials: "include",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                alias,
                ...(password ? { password } : {})
            })
        });

        const data = await response.json();

        if (data.success === false) {
            throw new Error(data.errorKey || "errors.generic");
        }
        return data;
    }

    static async uploadAvatar(formData: FormData) {
        try {
            const response = await fetch(`${this.API_URL}/me/avatar`, {
                method: "POST",
                credentials: "include",
                body: formData
            });

            const data = await response.json();
            if (!response.ok)
                throw new Error(data.errorKey || data.error);
            return data;
        } catch (error) {
            alert(lang((error as Error).message) || (error as Error).message);
        }
    }

    static async getFriends() {
        try {
            const response = await fetch(`${this.API_URL}/me/friends`, {
                method: "GET",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json"
                }
            })

            const data = await response.json()
            if (!response.ok) throw new Error(data.errorKey || data.error)
            return data
        } catch (error) {
            alert(lang((error as Error).message) || (error as Error).message)
        }
    }

    static async addFriend(friendAlias: string) {
        const response = await fetch(`${this.API_URL}/me/friends/add`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ friendAlias })
        })

        const data = await response.json()
        if (data.success === false) {
            throw new Error(data.errorKey || "errors.generic")
        }
        return data
    }

    static async getFriendRequests() {
        try {
            const response = await fetch(`${this.API_URL}/me/friends/requests`, {
                method: "GET",
                credentials: "include",
                headers: { "Content-Type": "application/json" }
            })

            const data = await response.json()
            if (!response.ok) throw new Error(data.errorKey || data.error)
            return data
        } catch (error) {
            alert(lang((error as Error).message) || (error as Error).message)
        }
    }

    static async acceptFriendRequest(friend_id: number) {
        try {
            const response = await fetch(`${this.API_URL}/me/friends/requests/accept`, {
                method: "PUT",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ friend_id })
            })

            const data = await response.json()
            if (!response.ok) throw new Error(data.errorKey || data.error)
            return data
        } catch (error) {
            alert(lang((error as Error).message) || (error as Error).message)
        }
    }

    static async getUserByAlias(alias: string) {
        try {
            const response = await fetch(`${this.API_URL}/${alias}`, {
                method: "GET",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json"
                }
            });

            const data = await response.json();

            if (!response.ok || data.success === false) {
                throw new Error(data.errorKey || data.error || "errors.generic");
            }

            return data;

        } catch (error) {
            throw error;
        }
    }

    static async blockUser(friend_id: number) {
        const response = await fetch(`${this.API_URL}/me/friends/block`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ friend_id })
        })

        const data = await response.json()

        if (!response.ok) {
            throw new Error(data.errorKey || data.error || "errors.generic")
        }

        return data
    }

    static async unblockUser(friend_id: number) {
        const response = await fetch(`${this.API_URL}/me/friends/unblock`, {
            method: "DELETE",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ friend_id })
        })

        const data = await response.json()

        if (!response.ok) {
            throw new Error(data.errorKey || data.error || "errors.generic")
        }

        return data
    }

    static async getBlockedUsers() {
        try {
            const response = await fetch(`${this.API_URL}/me/friends/blocked`, {
                method: "GET",
                credentials: "include",
                headers: { "Content-Type": "application/json" }
            })

            const data = await response.json()
            if (!response.ok) throw new Error(data.errorKey || data.error)
            return data
        } catch (error) {
            alert(lang((error as Error).message) || (error as Error).message)
        }
    }
}