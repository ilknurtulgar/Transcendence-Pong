import i18n from "i18next";

import tr from "./locales/tr.json"
import en from "./locales/en.json"
import fr from "./locales/fr.json"

const savedLang = localStorage.getItem("lang") || "tr";

i18n.init({
    lng: savedLang,
    fallbackLng: "en",
    resources: {
        tr: { translation: tr },
        en: { translation: en },
        fr: { translation: fr },
    },
    interpolation: {
        escapeValue: false
    }
});

export default i18n;