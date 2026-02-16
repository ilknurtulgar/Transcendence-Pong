import { lang } from "../i18n/lang";
import { AuthService } from "../services/AuthService";
import type { IPage } from "../types/ipage";

export class LoginPage implements IPage {

    private goTo: (path: string, params?: any) => void;

    constructor(goTo: (path: string, params?: any) => void) {
        this.goTo = goTo;
    }

    render(): string {
        return `
        <div class="min-h-screen flex flex-col items-center justify-center relative px-4 py-8">
            <img src="/ahakan.png" alt="Left" class="absolute left-2 sm:left-4 lg:left-8 xl:left-32 top-4 sm:top-6 lg:top-1/2 lg:-translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 lg:w-40 lg:h-40 xl:w-52 xl:h-52 object-contain" />
			
            <img src="/asanli.png" alt="Right" class="absolute right-2 sm:right-4 lg:right-8 xl:right-32 top-4 sm:top-6 lg:top-1/2 lg:-translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 md:w-16 md:h-16 lg:w-40 lg:h-40 xl:w-52 xl:h-52 object-contain" />
			
            <img src="/ilkkus.png" alt="Logo" class="relative w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 lg:w-28 lg:h-28 object-contain mb-8 z-20" />
			
			<form id="loginForm" class="bg-white p-8 rounded shadow w-full max-w-[450px] flex flex-col gap-6 relative z-10">
        <h1 class="text-2xl font-bold mb-2 text-center">${lang('auth.login')}</h1>
        
        <div class="mb-10">
          <input id="username" type="text" placeholder="${lang('auth.username')}" class="w-full p-4 text-lg border rounded" />
        </div>
        
        <div class="mb-8">
          <input id="password" type="password" placeholder="${lang('auth.password')}" class="w-full p-4 text-lg border rounded" />
        </div>
        
				<button type="submit" class="w-full bg-pink-600 text-white py-3 text-lg rounded hover:bg-pink-700">${lang('auth.signIn')}</button>
				                                <button type="button" id="githubLogin" class="w-full bg-black text-white py-3 text-lg rounded hover:bg-gray-900">${lang('auth.githubLogin')}</button>
<button type="button" id="goRegister" class="w-full bg-gray-300 py-3 text-lg rounded hover:bg-gray-400">${lang('auth.signUp')}</button>
      </form>
    </div>
  `;
    }

    mount(): void {
        const form = document.getElementById("loginForm") as HTMLFormElement;
        const btn = document.getElementById("goRegister") as HTMLButtonElement;
        const usernameInput = document.getElementById("username") as HTMLInputElement;
        const passwordInput = document.getElementById("password") as HTMLInputElement;
        const githubBtn = document.getElementById("githubLogin") as HTMLButtonElement;


        if (form) {
            form.addEventListener("submit", async (e) => {
                e.preventDefault();

                const username = usernameInput.value.trim();
                const password = passwordInput.value.trim();

                if (!username || !password) {
                    alert(lang('auth.usernamePasswordRequired'));
                    return;
                }

                try {
                    const response = await AuthService.login(username, password);

                    if (response.twoFactorRequired === true) {
                        this.goTo("/2fa");
                    } else {
                        this.goTo("/home");
                    }

                } catch (err) {
                    const errorKey = (err as Error).message;
                    alert(lang(errorKey) || errorKey);
                }
            });
        }

        if (githubBtn) {
            githubBtn.addEventListener("click", () => {
                window.location.href = 'https://localhost/api/users/auth/github';
            });
        }

        if (btn) {
            btn.addEventListener("click", () => {
                this.goTo("/register");
            });
        }

    }
    unmount(): void {
    }

}
