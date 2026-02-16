import type { IPage } from "../types/ipage";
import { TwoFAService } from "../services/TwoFAService";
import { lang } from "../i18n/lang";


export class TwoFAVerifyPage implements IPage {
	private goTo: (path: string, params?: any) => void;

	constructor(goTo: (path: string, params?: any) => void) {
		this.goTo = goTo;
	}

	render(): string {
		return `
		<div class="min-h-screen flex flex-col items-center justify-center gap-4 px-4">
		<h1 class="text-lg sm:text-xl font-bold text-center">${lang('twofa.verify.title')}</h1>

		<input
			id="2fa"
			type="text"
			placeholder="${lang('twofa.verify.codePlaceholder')}"
			maxlength="6"
			inputmode="numeric"
			pattern="\\d{6}"
			class="border p-3 rounded w-full max-w-xs text-center text-lg"
		/>

		<button
			id="verifyBtn"
			class="bg-pink-600 text-white px-6 py-3 rounded w-full max-w-xs"
		>
			${lang('twofa.verify.verifyButton')}
		</button>
		</div>
	`;
	}

	mount(): void {
		const faInput = document.getElementById("2fa") as HTMLInputElement;
		const btn = document.getElementById("verifyBtn") as HTMLButtonElement;

		if (btn && faInput) {
			btn.addEventListener("click", async () => {
				const code = faInput.value.trim();
				if (!code || code.length !== 6) {
					alert(lang('twofa.verify.enterCodeAlert'));
					return;
				}
				if (!/^\d+$/.test(code)) {
					alert(lang('twofa.setup.codeDigitsOnly'));
					return;
				}

				try {
					const response = await TwoFAService.verify2FA(code);
					if (response && response.message) {
						alert(lang('twofa.verify.verificationSuccess'));
						this.goTo("/home");
					} else {
						alert(lang('twofa.verify.verificationError'));
					}
				} catch (err: any) {
					const errorKey = err.message;
					alert(lang(errorKey) || errorKey);
				}

			});
		}
	}

	unmount(): void {
	}

}
