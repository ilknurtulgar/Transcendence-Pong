import { ProfileService } from "../services/ProfileService";
import { AuthService } from "../services/AuthService";
import type { IPage } from "../types/ipage";
import { chatStore } from "../services/ChatStore";
import { lang, setLang, getLang } from "../i18n/lang";

export class HomePage implements IPage {

	private goTo: (path: string, params?: any) => void;
	private unsubscribeChat: (() => void) | null = null;
	private windowClickHandler: ((e: MouseEvent) => void) | null = null;

	constructor(goTo: (path: string, params?: any) => void) {
		this.goTo = goTo;
	}

	render(): string {
		return `
		<div class="min-h-screen relative">
		<header class="absolute top-0 right-0 p-4 flex items-center gap-4">
			<div class="flex gap-2 bg-white rounded-lg shadow-md p-1 border border-gray-200">
				<button id="langTR" class="lang-btn lang-btn-active px-3 py-2 text-sm font-semibold text-purple-600 hover:bg-gray-100 rounded transition-colors">TR</button>
				<button id="langEN" class="lang-btn px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded transition-colors">EN</button>
				<button id="langFR" class="lang-btn px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 rounded transition-colors">FR</button>
			</div>
			
			<div class="relative inline-block">
				<button id="dropdownBtn" class="flex items-center gap-2 bg-gradient-to-r from-green-600 to-purple-600 text-white px-4 py-2 rounded-lg hover:from-green-700 hover:to-purple-700 transition-colors">
					<span>${lang('common.menu')}</span>
					<svg class="h-4 w-4 transition-transform" id="dropdownArrow" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
					</svg>
				</button>
				
				<div id="dropdownMenu" class="hidden absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 overflow-hidden z-50">
					<button id="profileEditBtn" class="w-full flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-gray-100 transition-colors text-left">
						<svg class="h-5 w-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
						</svg>
						<span>${lang('nav.profileEdit')}</span>
					</button>
					<button id="2faBtn" class="w-full flex items-center gap-3 px-4 py-3 text-gray-700 hover:bg-gray-100 transition-colors text-left border-t border-gray-100">
						<svg class="h-5 w-5 text-pink-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
						</svg>
						<span id="2faText">${lang('nav.twoFaActivate')}</span>
					</button>				<button id="logoutBtn" class="w-full flex items-center gap-3 px-4 py-3 text-red-600 hover:bg-red-50 transition-colors text-left border-t border-gray-100">
					<svg class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
					</svg>
					<span>${lang('nav.logout')}</span>
				</button>				</div>
			</div>
		</header>

		<div class="flex items-center justify-center flex-col gap-6 sm:gap-8 md:gap-12 min-h-screen px-4 pt-16 pb-8">
			<h1 class="text-2xl sm:text-3xl md:text-4xl lg:text-6xl font-bold text-center mt-4">${lang('home.welcome')}</h1>
			
			<div class="flex gap-4 sm:gap-6 md:gap-8 justify-center flex-wrap max-w-3xl">
				<img src="/ahakan.png" alt="Ahakan" class="h-20 w-20 sm:h-24 sm:w-24 md:h-32 md:w-32 rounded-full object-cover shadow-lg border-4 border-gray-200 hover:scale-110 transition-transform">
				<img src="/ilkkus.png" alt="İlkkuş" class="h-20 w-20 sm:h-24 sm:w-24 md:h-32 md:w-32 rounded-full object-cover shadow-lg border-4 border-gray-200 hover:scale-110 transition-transform">
				<img src="/asanli.png" alt="Asanli" class="h-20 w-20 sm:h-24 sm:w-24 md:h-32 md:w-32 rounded-full object-cover shadow-lg border-4 border-gray-200 hover:scale-110 transition-transform">
			</div>
			
			<div class="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 md:gap-8 w-full max-w-2xl">
				<button id="chatBtn" class="flex flex-col items-center justify-center gap-3 sm:gap-4 p-6 sm:p-8 bg-gradient-to-br from-green-500 to-green-600 text-white rounded-lg hover:from-green-600 hover:to-green-700 transition-all transform hover:scale-105 shadow-lg">
					<svg class="h-12 w-12 sm:h-14 sm:w-14 md:h-16 md:w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M21 12c0 4.418-4.03 8-9 8a10.97 10.97 0 01-4-.744L3 20l1.183-3.154A7.902 7.902 0 013 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
					</svg>
					<span class="text-xl sm:text-2xl font-semibold">${lang('common.chat')}</span>
					<span id="chatUnreadBadge" class="hidden text-xs px-3 py-1 rounded-full bg-red-500 text-white">0</span>
				</button>

				<button id="gameBtn" class="flex flex-col items-center justify-center gap-3 sm:gap-4 p-6 sm:p-8 bg-gradient-to-br from-purple-500 to-purple-600 text-white rounded-lg hover:from-purple-600 hover:to-purple-700 transition-all transform hover:scale-105 shadow-lg">
					<svg class="h-12 w-12 sm:h-14 sm:w-14 md:h-16 md:w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6V4m0 2a8 8 0 018 8v2a2 2 0 01-2 2h-1m-4-2H7m10 0a2 2 0 01-2 2H9a2 2 0 01-2-2m10-4h.01M7 12h.01M9 16h6" />
					</svg>
					<span class="text-xl sm:text-2xl font-semibold">${lang('common.game')}</span>
				</button>
			</div>
		</div>
		</div>
	`;
	}


	async mount(): Promise<void> {
		const btn = document.getElementById("2faBtn") as HTMLButtonElement;
		const logoutBtn = document.getElementById("logoutBtn") as HTMLButtonElement;
		const twoFaText = document.getElementById("2faText");
		const dropdownBtn = document.getElementById("dropdownBtn");
		const dropDownMenu = document.getElementById("dropdownMenu");
		const dropdownArrow = document.getElementById("dropdownArrow");
		const profileEditBtn = document.getElementById("profileEditBtn");
		const chatBtn = document.getElementById("chatBtn");
		const gameBtn = document.getElementById("gameBtn");
		const chatUnreadBadge = document.getElementById("chatUnreadBadge") as HTMLSpanElement | null;

		const langTR = document.getElementById("langTR") as HTMLButtonElement;
		const langEN = document.getElementById("langEN") as HTMLButtonElement;
		const langFR = document.getElementById("langFR") as HTMLButtonElement;

		const syncChatBadge = () => {
			if (!chatUnreadBadge) return;
			const n = chatStore.getTotalUnread();
			chatUnreadBadge.textContent = String(n);
			if (n > 0) chatUnreadBadge.classList.remove('hidden');
			else chatUnreadBadge.classList.add('hidden');
		};

		this.unsubscribeChat?.();
		this.unsubscribeChat = chatStore.onChange(syncChatBadge);
		syncChatBadge();

		const currentLang = getLang();
		const langButtons = { tr: langTR, en: langEN, fr: langFR };
		const activeLangBtn = langButtons[currentLang as keyof typeof langButtons];
		if (activeLangBtn) {
			langTR?.classList.remove('lang-btn-active', 'text-purple-600');
			langEN?.classList.remove('lang-btn-active', 'text-purple-600');
			langFR?.classList.remove('lang-btn-active', 'text-purple-600');
			langTR?.classList.add('text-gray-600');
			langEN?.classList.add('text-gray-600');
			langFR?.classList.add('text-gray-600');
			activeLangBtn.classList.add('lang-btn-active', 'text-purple-600');
			activeLangBtn.classList.remove('text-gray-600');
		}

		langTR?.addEventListener('click', () => {
			setLang('tr');
		});

		langEN?.addEventListener('click', () => {
			setLang('en');
		});

		langFR?.addEventListener('click', () => {
			setLang('fr');
		});

		dropdownBtn?.addEventListener('click', (hihi) => {
			hihi.stopPropagation();
			dropDownMenu?.classList.toggle('hidden');
			dropdownArrow?.classList.toggle('rotate-180');
		});

		this.windowClickHandler = () => {
			if (!dropDownMenu?.classList.contains('hidden')) {
				dropDownMenu?.classList.add('hidden');
				dropdownArrow?.classList.remove('rotate-180');
			}
		};
		window.addEventListener('click', this.windowClickHandler);

		profileEditBtn?.addEventListener('click', () => {
			this.goTo("/profile-edit");
		})

		chatBtn?.addEventListener('click', () => {
			this.goTo("/chat");
		})

		gameBtn?.addEventListener('click', () => {
			this.goTo("/game");
		})

		logoutBtn?.addEventListener('click', async () => {
			try {
				await AuthService.logout();
				this.goTo("/login");
			} catch (err: any) {
			}
		})

		if (btn) btn.disabled = true;

		try {
			const response = await ProfileService.twoFaStatus();


			if (!response || !response.user) {
				this.goTo("/login");
				return;
			}

			if (response.user.is_two_factor_enabled === 1) {
				if (btn && twoFaText) {
					btn.disabled = true;
					btn.classList.add("cursor-not-allowed", "opacity-50");
					twoFaText.textContent = lang('auth.twoFaAlreadyActive');
				}
			} else {
				if (btn) btn.disabled = false;
			}
		} catch (err) {

			this.goTo("/login");
			return;
		}

		if (btn) {
			btn.addEventListener("click", () => {
				if (!btn.disabled) {
					this.goTo("/setup-2fa");
				}
			})
		}

	}

	unmount(): void {
		this.unsubscribeChat?.();
		this.unsubscribeChat = null;

		if (this.windowClickHandler) {
			window.removeEventListener('click', this.windowClickHandler);
			this.windowClickHandler = null;
		}
	}
}
