import { ProfileService } from "../services/ProfileService";
import type { IPage } from "../types/ipage";
import { lang } from "../i18n/lang";

export class GuestProfileViewPage implements IPage {
    private userAlias: string;

    constructor(_goTo: (path: string, params?: any) => void, userAlias: string) {
        this.userAlias = userAlias;
    }

    render(): string {
        return `
    <div class="min-h-screen bg-gray-50">
        <header class="bg-white border-b">
            <div class="max-w-6xl mx-auto px-4 py-3 sm:py-4 flex items-center gap-3">
                <button id="backBtn" class="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm sm:text-base">
                    ← ${lang('common.back')}
                </button>
                <h1 class="text-lg sm:text-xl font-semibold">${lang('nav.profile')}</h1>
            </div>
        </header>
        
        <div class="flex items-center justify-center min-h-[calc(100vh-73px)] p-4">
        <div class="w-full max-w-4xl bg-white shadow-xl rounded-2xl overflow-hidden">
            <div class="bg-pink-800 text-white p-4 sm:p-6">
                <h2 class="text-lg sm:text-xl font-semibold">${lang('nav.profile')}</h2>
            </div>

            <div class="flex flex-col md:flex-row items-center md:items-start gap-6 p-4 sm:p-8 border-b border-gray-100">
                <div class="relative group w-24 h-24 sm:w-32 sm:h-32 shrink-0">
                    <img id="profilePreview" src="http://localhost:3000/uploads/default_avatar.jpg" class="w-full h-full rounded-full object-cover border-2 border-gray-200">
                </div>

                <div class="flex-1 w-full text-center md:text-left">
                    <div class="flex flex-col gap-4 sm:gap-6">
                        <div>
                            <span class="block text-xs sm:text-sm font-semibold text-gray-400 uppercase">${lang('auth.username')}</span>
                            <span id="usernameDisplay" class="text-lg sm:text-xl font-medium text-gray-800">${lang('profile.loading')}</span>
                        </div>
                        <div class="flex gap-6 justify-center md:justify-start">
                            <div>
                                <span class="block text-xs sm:text-sm font-semibold text-gray-400 uppercase">${lang('profile.wins')}</span>
                                <span id="winsDisplay" class="text-lg sm:text-xl font-medium text-gray-800">-</span>
                            </div>
                            <div>
                                <span class="block text-xs sm:text-sm font-semibold text-gray-400 uppercase">${lang('profile.losses')}</span>
                                <span id="lossesDisplay" class="text-lg sm:text-xl font-medium text-gray-800">-</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="w-full md:w-auto flex flex-col items-center gap-2 shrink-0">
                    <span class="text-xs text-gray-400 uppercase font-semibold">${lang('profile.blockStatus')}</span>
                    <button id="blockActionBtn" class="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-200 text-gray-700 hover:bg-gray-300 w-full md:w-auto">
                        ${lang('profile.notBlockedStatus')}
                    </button>
                </div>
            </div>

            <div class="border-t border-gray-100 p-6">
                <h3 class="text-sm font-semibold text-gray-700 uppercase mb-4">${lang('profile.statsChart')}</h3>
                <div class="flex flex-col sm:flex-row items-center justify-center gap-6">
                    <div id="donutChartContainer" class="w-40 h-40 relative">
                        <svg id="donutSvg" viewBox="0 0 120 120" class="w-full h-full">
                            <circle cx="60" cy="60" r="50" fill="none" stroke="#e5e7eb" stroke-width="18" />
                            <circle id="donutWin" cx="60" cy="60" r="50" fill="none" stroke="#22c55e" stroke-width="18"
                                stroke-dasharray="0 314.16" stroke-dashoffset="-78.54"
                                stroke-linecap="round" transform="rotate(-90 60 60)" />
                            <circle id="donutLose" cx="60" cy="60" r="50" fill="none" stroke="#ef4444" stroke-width="18"
                                stroke-dasharray="0 314.16" stroke-dashoffset="-78.54"
                                stroke-linecap="round" transform="rotate(-90 60 60)" />
                        </svg>
                        <div class="absolute inset-0 flex flex-col items-center justify-center">
                            <span id="winRateText" class="text-xl font-bold text-gray-800">-</span>
                            <span class="text-[10px] text-gray-400 uppercase">${lang('profile.winRate')}</span>
                        </div>
                    </div>
                    <div class="flex flex-col gap-2 text-sm">
                        <div class="flex items-center gap-2">
                            <span class="w-3 h-3 rounded-full bg-green-500 inline-block"></span>
                            <span class="text-gray-600">${lang('profile.wins')}:</span>
                            <span id="winsChartCount" class="font-semibold text-gray-800">0</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="w-3 h-3 rounded-full bg-red-500 inline-block"></span>
                            <span class="text-gray-600">${lang('profile.losses')}:</span>
                            <span id="lossesChartCount" class="font-semibold text-gray-800">0</span>
                        </div>
                    </div>
                </div>
                <p id="noGamesMsg" class="hidden text-sm text-gray-400 text-center mt-2">${lang('profile.noGames')}</p>
            </div>
        </div>
        </div>
    </div>
    `;
    }

    async mount(): Promise<void> {
        const backBtn = document.getElementById('backBtn') as HTMLButtonElement;
        const usernameDisplay = document.getElementById('usernameDisplay') as HTMLElement;
        const winsDisplay = document.getElementById('winsDisplay') as HTMLElement;
        const lossesDisplay = document.getElementById('lossesDisplay') as HTMLElement;
        const profilePreview = document.getElementById('profilePreview') as HTMLImageElement;
        const blockActionBtn = document.getElementById('blockActionBtn') as HTMLButtonElement;

        let targetUserId: number | null = null;
        let isBlocked = false;

        const setBlockButton = (blocked: boolean) => {
            isBlocked = blocked;
            blockActionBtn.textContent = blocked
                ? lang('profile.blockedStatus')
                : lang('profile.notBlockedStatus');

            blockActionBtn.classList.toggle('bg-red-500', blocked);
            blockActionBtn.classList.toggle('text-white', blocked);
            blockActionBtn.classList.toggle('hover:bg-red-600', blocked);

            blockActionBtn.classList.toggle('bg-gray-200', !blocked);
            blockActionBtn.classList.toggle('text-gray-700', !blocked);
            blockActionBtn.classList.toggle('hover:bg-gray-300', !blocked);
        };

        const refreshBlocked = async () => {
            const blockedResponse = await ProfileService.getBlockedUsers();
            const blockedUsers = blockedResponse?.blocked || [];
            if (targetUserId !== null) {
                setBlockButton(blockedUsers.some((u: any) => u.id === targetUserId));
            }
        };

        backBtn?.addEventListener('click', () => {
            window.history.back();
        });

        try {
            const response = await ProfileService.getUserByAlias(this.userAlias);
            const userData = Array.isArray(response.user) ? response.user[0] : response.user;

            if (userData) {
                targetUserId = userData.id;
                usernameDisplay.textContent = userData.alias;
                winsDisplay.textContent = userData.wins?.toString() || '0';
                lossesDisplay.textContent = userData.losses?.toString() || '0';

                const defaultAvatar = `http://localhost:3000/uploads/default_avatar.jpg`;
                profilePreview.src = userData.avatar_url
                    ? `http://localhost:3000${userData.avatar_url}`
                    : defaultAvatar;

                profilePreview.onerror = () => { profilePreview.src = defaultAvatar; };

                const wins = Number(userData.wins) || 0;
                const losses = Number(userData.losses) || 0;
                const total = wins + losses;
                const winsChartCount = document.getElementById('winsChartCount');
                const lossesChartCount = document.getElementById('lossesChartCount');
                const winRateText = document.getElementById('winRateText');
                const donutWin = document.getElementById('donutWin') as unknown as SVGCircleElement;
                const donutLose = document.getElementById('donutLose') as unknown as SVGCircleElement;
                const noGamesMsg = document.getElementById('noGamesMsg');

                if (winsChartCount) winsChartCount.textContent = String(wins);
                if (lossesChartCount) lossesChartCount.textContent = String(losses);

                if (total === 0) {
                    if (winRateText) winRateText.textContent = '-';
                    if (noGamesMsg) noGamesMsg.classList.remove('hidden');
                } else {
                    const circumference = 2 * Math.PI * 50;
                    const winPct = wins / total;
                    const losePct = losses / total;
                    const winArc = winPct * circumference;
                    const loseArc = losePct * circumference;

                    if (donutWin) {
                        donutWin.setAttribute('stroke-dasharray', `${winArc} ${circumference - winArc}`);
                        donutWin.setAttribute('stroke-dashoffset', '0');
                    }
                    if (donutLose) {
                        donutLose.setAttribute('stroke-dasharray', `${loseArc} ${circumference - loseArc}`);
                        donutLose.setAttribute('stroke-dashoffset', `${-winArc}`);
                    }
                    if (winRateText) winRateText.textContent = `${Math.round(winPct * 100)}%`;
                }
            }

            await refreshBlocked();
        } catch (error) {
            const errorKey = (error as Error).message;
            if (usernameDisplay) usernameDisplay.textContent = lang(errorKey) || lang('profile.loadError');

            alert(lang(errorKey) || errorKey);
        }

        blockActionBtn?.addEventListener('click', async () => {
            if (targetUserId === null) return;
            const shouldBlock = !isBlocked;

            blockActionBtn.disabled = true;
            try {
                if (shouldBlock) {
                    await ProfileService.blockUser(targetUserId);
                } else {
                    await ProfileService.unblockUser(targetUserId);
                }
                await refreshBlocked();
            } catch (err) {
                const errorKey = (err as Error).message;
                alert(lang(errorKey) || errorKey);
                setBlockButton(!shouldBlock);
            } finally {
                blockActionBtn.disabled = false;
            }
        });
    }

    unmount(): void {
    }
}
