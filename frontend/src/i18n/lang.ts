import i18n from "./init";
import { apiUrl } from "../services/api";

export function lang(key: string): string {
    return i18n.t(key);
}

export function setLang(lang: "tr" | "en" | "fr") {
    i18n.changeLanguage(lang).then(() => {
        localStorage.setItem("lang", lang);
        fetch(apiUrl("/api/profiles/me"), {
            method: "PUT",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ language: lang })
        }).catch(() => { });

        window.dispatchEvent(new CustomEvent("languageChanged"));
    });
}

export function getLang() {
    return i18n.language;
}

export async function loadUserLang(): Promise<void> {
    try {
        const res = await fetch(apiUrl("/api/profiles/me"), {
            method: "GET",
            credentials: "include",
            headers: { "Content-Type": "application/json" }
        });

        if (!res.ok) return;

        const data = await res.json();
        const userLang = data?.user?.language;

        if (userLang && ["tr", "en", "fr"].includes(userLang)) {
            localStorage.setItem("lang", userLang);
            if (i18n.language !== userLang) {
                await i18n.changeLanguage(userLang);
            }
        }
    } catch {
    }
}