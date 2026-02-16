export function apiUrl(path: string): string {
    const normalized = path.startsWith('/') ? path : `/${path}`

    if (typeof window === 'undefined') return `http://localhost:3000${normalized}`

    const { protocol, hostname, port } = window.location

    if (protocol === 'https:' || port === '443') return normalized

    if (port === '5173') return `http://${hostname}:3000${normalized}`

    return normalized
}
