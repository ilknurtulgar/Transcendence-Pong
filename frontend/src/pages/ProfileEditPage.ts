import { ProfileService } from "../services/ProfileService";
import type { IPage } from "../types/ipage";
import { lang } from "../i18n/lang";

export class ProfileEditPage implements IPage {
    private goTo: (path: string, params?: any) => void;

    constructor(goTo: (path: string, params?: any) => void) {
        this.goTo = goTo;
    }


    render(): string {
        return `
    <div class="min-h-screen bg-gray-50">
        <header class="bg-white border-b">
            <div class="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
                <button id="backBtn" class="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700">
                    ← ${lang('common.back')}
                </button>
                <h1 class="text-xl font-semibold">${lang('nav.profileEdit')}</h1>
            </div>
        </header>
        
        <div class="flex items-center justify-center min-h-[calc(100vh-73px)] p-4">
        <div class="w-full max-w-4xl bg-white shadow-xl rounded-2xl overflow-hidden">
            <div class="bg-pink-800 text-white p-6">
                <h2 class="text-xl font-semibold">${lang('nav.profile')}</h2>
            </div>

            <div class="flex flex-col md:flex-row items-center md:items-start gap-6 p-4 sm:p-8 border-b border-gray-100">
                <div class="relative group w-24 h-24 sm:w-32 sm:h-32 shrink-0">
                    <img id="profilePreview" src="http://localhost:3000/uploads/default_avatar.jpg" class="w-full h-full rounded-full object-cover border-2 border-gray-200">
                    <label for="avatarInput" id="avatarEditIcon" class="hidden absolute inset-0 bg-black/40 rounded-full flex items-center justify-center cursor-pointer group-hover:bg-black/50 transition-all">
                        <svg class="w-6 h-6 sm:w-8 sm:h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                        </svg>
                        <input type="file" id="avatarInput" class="hidden" accept="image/*">
                    </label>
                </div>

                <div class="flex-1 w-full">
                    <div class="flex flex-col gap-4 sm:gap-6">
                        <div>
                            <span class="block text-xs sm:text-sm font-semibold text-gray-400 uppercase">${lang('auth.username')}</span>
                            <span id="usernameDisplay" class="text-lg sm:text-xl font-medium text-gray-800">${lang('profile.loading')}</span>
                            <input id="usernameInput" type="text" class="hidden w-full px-3 sm:px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-base sm:text-lg" value="">
                        </div>
                        <div>
                            <span class="block text-xs sm:text-sm font-semibold text-gray-400 uppercase">${lang('auth.password')}</span>
                            <span id="passwordDisplay" class="text-lg sm:text-xl font-medium text-gray-800">••••••••</span>
                            <input id="passwordInput" type="password" class="hidden w-full px-3 sm:px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-base sm:text-lg" placeholder="${lang('profile.newPasswordOptional')}">
                        </div>
                    </div>
                </div>

                <div class="w-full md:w-auto flex flex-col gap-3 shrink-0">
                    <button id="editBtn" class="bg-pink-500 hover:bg-pink-600 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-lg transition-all flex items-center justify-center gap-2 text-base sm:text-lg w-full md:w-auto">
                        <span>${lang('common.edit')}</span>
                    </button>
                    <div id="saveCancelGroup" class="hidden flex flex-col gap-3 w-full">
                        <button id="saveBtn" class="bg-pink-500 hover:bg-pink-600 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-lg transition-all text-base sm:text-lg">${lang('common.save')}</button>
                        <button id="cancelBtn" class="bg-gray-200 hover:bg-gray-300 text-gray-700 px-4 sm:px-6 py-2 sm:py-3 rounded-lg transition-all text-base sm:text-lg">${lang('common.cancel')}</button>
                    </div>
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
                            <span id="winsCount" class="font-semibold text-gray-800">0</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="w-3 h-3 rounded-full bg-red-500 inline-block"></span>
                            <span class="text-gray-600">${lang('profile.losses')}:</span>
                            <span id="lossesCount" class="font-semibold text-gray-800">0</span>
                        </div>
                    </div>
                </div>
                <p id="noGamesMsg" class="hidden text-sm text-gray-400 text-center mt-2">${lang('profile.noGames')}</p>
            </div>

            <div class="border-t border-gray-100 p-6">
                <h3 class="text-sm font-semibold text-gray-700 uppercase mb-4">${lang('profile.blockedUsers')}</h3>
                <p id="blockedEmpty" class="text-sm text-gray-500">${lang('profile.noBlockedUsers')}</p>
                <div id="blockedUsersContainer" class="space-y-3"></div>
            </div>
        </div>
        </div>
    </div>
    `;
    }

    async mount(): Promise<void> {
        const backBtn = document.getElementById('backBtn') as HTMLButtonElement;
        const editBtn = document.getElementById('editBtn') as HTMLButtonElement;
        const saveCancelGroup = document.getElementById('saveCancelGroup') as HTMLElement;
        const saveBtn = document.getElementById('saveBtn') as HTMLButtonElement;
        const cancelBtn = document.getElementById('cancelBtn') as HTMLButtonElement;

        const usernameDisplay = document.getElementById('usernameDisplay') as HTMLElement;
        const usernameInput = document.getElementById('usernameInput') as HTMLInputElement;
        const passwordDisplay = document.getElementById('passwordDisplay') as HTMLElement;
        const passwordInput = document.getElementById('passwordInput') as HTMLInputElement;

        const avatarEditIcon = document.getElementById('avatarEditIcon') as HTMLElement;
        const avatarInput = document.getElementById('avatarInput') as HTMLInputElement;
        const profilePreview = document.getElementById('profilePreview') as HTMLImageElement;

        const blockedEmpty = document.getElementById('blockedEmpty') as HTMLElement;
        const blockedUsersContainer = document.getElementById('blockedUsersContainer') as HTMLElement;

        const renderBlockedUsers = async () => {
            try {
                const response = await ProfileService.getBlockedUsers();
                const blockedUsers = response?.blocked || [];

                blockedUsersContainer.innerHTML = '';

                if (blockedUsers.length === 0) {
                    blockedEmpty.classList.remove('hidden');
                    return;
                }

                blockedEmpty.classList.add('hidden');

                blockedUsers.forEach((user: any) => {
                    const div = document.createElement('div');
                    div.className = 'flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200';

                    const avatarUrl = user.avatar_url
                        ? `http://localhost:3000${user.avatar_url}`
                        : 'http://localhost:3000/uploads/default_avatar.jpg';

                    const userInfo = document.createElement('div');
                    userInfo.className = 'flex items-center gap-3';

                    const img = document.createElement('img');
                    img.className = 'w-10 h-10 rounded-full object-cover border border-gray-300';
                    img.src = avatarUrl;
                    img.onerror = () => { img.src = 'http://localhost:3000/uploads/default_avatar.jpg'; };

                    const name = document.createElement('span');
                    name.className = 'text-sm font-medium text-gray-800';
                    name.textContent = user.alias;

                    userInfo.appendChild(img);
                    userInfo.appendChild(name);

                    const unblockBtn = document.createElement('button');
                    unblockBtn.className = 'px-3 py-1 text-sm bg-green-500 hover:bg-green-600 text-white rounded transition-colors';
                    unblockBtn.textContent = lang('profile.unblock');
                    unblockBtn.disabled = false;

                    unblockBtn.addEventListener('click', async () => {
                        unblockBtn.disabled = true;
                        try {
                            await ProfileService.unblockUser(user.id);
                            await renderBlockedUsers();
                        } catch (err) {
                            const errorKey = (err as Error).message;
                            alert(lang(errorKey) || errorKey);
                        } finally {
                            unblockBtn.disabled = false;
                        }
                    });

                    div.appendChild(userInfo);
                    div.appendChild(unblockBtn);
                    blockedUsersContainer.appendChild(div);
                });
            } catch (error) {
                console.error('Error loading blocked users:', error);
            }
        };


        backBtn?.addEventListener('click', () => {
            this.goTo('/home');
        });

        try {
            const response = await ProfileService.profileData();
            const userData = Array.isArray(response.user) ? response.user[0] : response.user;

            if (userData) {
                usernameDisplay.textContent = userData.alias;
                usernameInput.value = userData.alias;

                const defaultAvatar = `http://localhost:3000/uploads/default_avatar.jpg`;
                profilePreview.src = userData.avatar_url
                    ? `http://localhost:3000${userData.avatar_url}`
                    : defaultAvatar;

                profilePreview.onerror = () => { profilePreview.src = defaultAvatar; };

                const wins = Number(userData.wins) || 0;
                const losses = Number(userData.losses) || 0;
                const total = wins + losses;
                const winsCountEl = document.getElementById('winsCount');
                const lossesCountEl = document.getElementById('lossesCount');
                const winRateText = document.getElementById('winRateText');
                const donutWin = document.getElementById('donutWin') as unknown as SVGCircleElement;
                const donutLose = document.getElementById('donutLose') as unknown as SVGCircleElement;
                const noGamesMsg = document.getElementById('noGamesMsg');

                if (winsCountEl) winsCountEl.textContent = String(wins);
                if (lossesCountEl) lossesCountEl.textContent = String(losses);

                if (total === 0) {
                    if (winRateText) winRateText.textContent = '-';
                    if (noGamesMsg) noGamesMsg.classList.remove('hidden');
                } else {
                    const circumference = 2 * Math.PI * 50; // 314.16
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

            await renderBlockedUsers();
        } catch (error) {
            if (usernameDisplay) usernameDisplay.textContent = lang('profile.loadError');
        }

        const toggleEditMode = (isEditing: boolean) => {
            editBtn.classList.toggle('hidden', isEditing);
            saveCancelGroup.classList.toggle('hidden', !isEditing);

            usernameDisplay.classList.toggle('hidden', isEditing);
            usernameInput.classList.toggle('hidden', !isEditing);

            passwordDisplay.classList.toggle('hidden', isEditing);
            passwordInput.classList.toggle('hidden', !isEditing);

            avatarEditIcon.classList.toggle('hidden', !isEditing);

        };

        avatarInput?.addEventListener('change', (e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    profilePreview.src = event.target?.result as string;
                };
                reader.readAsDataURL(file);
            }
        });

        editBtn?.addEventListener('click', () => toggleEditMode(true));

        cancelBtn?.addEventListener('click', () => {
            usernameInput.value = usernameDisplay.textContent || "";
            passwordInput.value = "";
            avatarInput.value = "";
            toggleEditMode(false);
        });

        saveBtn?.addEventListener('click', async () => {
            const alias = usernameInput.value.trim();
            const password = passwordInput.value.trim();
            const avatarFile = avatarInput.files?.[0];

            if (!alias) {
                alert(lang('profile.aliasRequired'));
                return;
            }
            if (alias.length < 3) {
                alert(lang('auth.usernameMinLength'));
                return;
            }
            if (password && password.length < 6) {
                alert(lang('auth.passwordMinLength'));
                return;
            }
            try {
                const updatedUser = await ProfileService.updateProfile(alias, password);

                const userData = Array.isArray(updatedUser.user) ? updatedUser.user[0] : updatedUser.user;

                if (userData) {
                    usernameDisplay.textContent = userData.alias;
                    usernameInput.value = userData.alias;
                }
                if (avatarFile) {
                    const formData = new FormData();
                    formData.append("avatar", avatarFile);

                    const avatarResponse = await ProfileService.uploadAvatar(formData);
                    if (avatarResponse && avatarResponse.avatarUrl) {
                        profilePreview.src = `http://localhost:3000${avatarResponse.avatarUrl}`;
                    }
                }
                passwordInput.value = "";
                avatarInput.value = "";
                toggleEditMode(false);
                alert(lang('profile.updateSuccess'));
            } catch (err) {
                const errorKey = (err as Error).message;
                alert(lang(errorKey) || errorKey);
            }

        });
    }

    unmount(): void {
    }

}