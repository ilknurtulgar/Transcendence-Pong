import type { IPage } from '../types/ipage';
import { ws } from '../services/ws';
import { chatStore } from '../services/ChatStore';
import { AuthService } from '../services/AuthService';
import { ProfileService } from '../services/ProfileService';
import { lang, loadUserLang } from '../i18n/lang';

import { TwoFAVerifyPage } from '../pages/2fa';
import { ProfileEditPage } from '../pages/ProfileEditPage';
import { GuestProfileViewPage } from '../pages/GuestProfileViewPage';
import { RegisterPage } from '../pages/Register';
import { HomePage } from '../pages/Home';
import { LoginPage } from '../pages/Login';
import { SetupTwoFAPage } from '../pages/Setup2fa';
import { ChatPage } from '../pages/Chat';
import { GamePage } from '../pages/Game';

const app = document.getElementById('app')!;
let currentPage: IPage | null = null;
let routeSeq = 0;
let lastValidPath: string = '/home';


function showGlobalToast(message: string) {
	const existing = document.getElementById('globalToast');
	existing?.remove();

	const toast = document.createElement('div');
	toast.id = 'globalToast';
	toast.style.cssText = `
		position: fixed;
		top: 20px;
		right: 20px;
		background-color: #dc2626;
		color: white;
		padding: 12px 24px;
		border-radius: 8px;
		z-index: 10000;
		box-shadow: 0 4px 6px rgba(0,0,0,0.1);
	`;
	toast.textContent = message;
	document.body.appendChild(toast);

	setTimeout(() => {
		toast.remove();
	}, 3500);
}


export function navigate(path: string) {
	if (window.location.pathname === path) return;
	window.history.pushState({}, '', path);
	void router();
}


export async function router() {
	const seq = ++routeSeq;
	const path = window.location.pathname;
	const previousPath = lastValidPath;
	let nextPage: IPage | null = null;
	const goTo = (url: string) => navigate(url);


	const publicRoutes = ['/', '/login', '/register'];
	const isPublicRoute = publicRoutes.includes(path);


	const authState = await AuthService.getAuthState();
	if (seq !== routeSeq) return;

	if (authState === 'GUEST' && path === '/2fa') {
		navigate('/login');
		return;
	}

	if (authState === 'AUTHENTICATED' && isPublicRoute) {
		navigate('/home');
		return;
	}

	if (authState === 'NEEDS_2FA_VERIFY') {
		if (path !== '/2fa') {
			navigate('/2fa');
			return;
		}
	}

	if (authState === 'AUTHENTICATED' && path === '/2fa') {
		navigate('/home');
		return;
	}

	if (!isPublicRoute && path !== '/2fa') {
		if (authState === 'GUEST') {
			navigate('/login');
			return;
		}

		ws.connect();
		chatStore.init();
		await loadUserLang();
		if (seq !== routeSeq) return;
	}


	if (path === '/' || path === '/login') {
		nextPage = new LoginPage(goTo);

	} else if (path === '/register') {
		nextPage = new RegisterPage(goTo);

	} else if (path === '/2fa') {
		nextPage = new TwoFAVerifyPage(goTo);

	} else if (path === '/setup-2fa') {
		nextPage = new SetupTwoFAPage(goTo);

	} else if (path === '/home') {
		nextPage = new HomePage(goTo);

	} else if (path === '/profile-edit') {
		nextPage = new ProfileEditPage(goTo);

	} else if (path.startsWith('/profile/')) {
		const userAlias = decodeURIComponent(path.split('/')[2]);
		if (userAlias) {
			try {
				const myProfile = await ProfileService.profileData();
				const myAlias = myProfile?.user?.alias;
				if (myAlias && userAlias === myAlias) {
					navigate('/profile-edit');
					return;
				}

				const friendsData = await ProfileService.getFriends();
				const friends = Array.isArray(friendsData?.friends) ? friendsData.friends : [];
				const isFriend = friends.some((f: { alias?: string }) => f?.alias === userAlias);
				if (!isFriend) {
					if (currentPage) {
						window.history.replaceState({}, '', previousPath);
						showGlobalToast(lang('profile.mustBeFriends'));
						return;
					}
					navigate(previousPath || '/home');
					setTimeout(() => {
						showGlobalToast(lang('profile.mustBeFriends'));
					}, 100);
					return;
				}

				await ProfileService.getUserByAlias(userAlias);
				nextPage = new GuestProfileViewPage(goTo, userAlias);
			} catch (error) {
				const errorKey = (error as Error).message || 'profile.mustBeFriends';
				if (currentPage) {
					window.history.replaceState({}, '', previousPath);
					showGlobalToast(lang(errorKey) || lang('profile.mustBeFriends'));
					return;
				}
				navigate(previousPath || '/home');
				setTimeout(() => {
					showGlobalToast(lang(errorKey) || lang('profile.mustBeFriends'));
				}, 100);
				return;
			}
		} else {
			navigate('/home');
			return;
		}

	} else if (path === '/chat') {
		nextPage = new ChatPage(goTo);

	} else if (path === '/game') {
		nextPage = new GamePage(goTo);

	} else {
		navigate('/home');
		return;
	}
	if (!nextPage) return;

	if (currentPage) {
		try {
			currentPage.unmount();
		} catch (err) {
			console.error('Page unmount error:', err);
		}
		currentPage = null;
	}

	app.innerHTML = '';
	currentPage = nextPage;
	app.innerHTML = currentPage.render();
	currentPage.mount();

	lastValidPath = path;
}


window.onpopstate = () => void router();
window.addEventListener('languageChanged', () => void router());
void router();
