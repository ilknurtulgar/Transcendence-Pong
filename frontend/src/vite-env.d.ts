
interface ImportMetaEnv {
    [key: string]: string | boolean | undefined
}

interface ImportMeta {
    readonly env: ImportMetaEnv
}

declare module "*.css";
