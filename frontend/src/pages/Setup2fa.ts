import type { IPage } from "../types/ipage";
import { TwoFAService } from "../services/TwoFAService";
import { lang } from "../i18n/lang";

export class SetupTwoFAPage implements IPage {
	private goTo: (path: string, params?: any) => void;

	constructor(goTo: (path: string, params?: any) => void) {
		this.goTo = goTo;
	}

	render(): string {
		return `
		<div class="min-h-screen bg-gray-50">
			<header class="bg-white border-b">
				<div class="max-w-6xl mx-auto px-4 py-3 sm:py-4 flex items-center gap-3">
					<button id="backBtn" class="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm sm:text-base">
						← ${lang('common.back')}
					</button>
					<h1 class="text-lg sm:text-xl font-semibold">${lang('twofa.setup.title')}</h1>
				</div>
			</header>

			<div class="flex items-center justify-center min-h-[calc(100vh-73px)] p-4">
				<div class="bg-white p-4 sm:p-6 rounded shadow w-full max-w-sm sm:max-w-md text-center">
					<p class="text-gray-600 mb-4 text-sm sm:text-base">${lang('twofa.setup.description')}</p>
					<div class="flex justify-center mb-6">
						<img 
							id="qrImage" 
							src="" 
							alt="${lang('twofa.setup.qrLoading')}" 
							class="border p-2 rounded w-40 h-40 sm:w-48 sm:h-48 bg-gray-100"
						/>
					</div>
					<p class="text-gray-600 mb-2 text-sm sm:text-base">${lang('twofa.setup.enterCode')} </p>
					<input
						id="setup2faCode"
						type="text"
						placeholder="${lang('twofa.setup.codePlaceholder')}" 
						maxlength="6"
						inputmode="numeric"
						pattern="\\\\d{6}"
						class="w-full mb-4 p-3 border rounded text-center text-lg"
					/>
					<button
						id="verifySetup2faBtn"
						class="w-full bg-pink-600 text-white py-3 rounded hover:bg-pink-700"
					>
						${lang('twofa.setup.verifyButton')} 
					</button>
				</div>
			</div>
		</div>
	`;
	}

	async mount(): Promise<void> {
		const backBtn = document.getElementById("backBtn") as HTMLButtonElement;
		backBtn?.addEventListener("click", () => {
			this.goTo("/home");
		});

		try {
			const meResponse = await fetch("http://localhost:3000/api/users/me", {
				credentials: "include"
			});

			if (meResponse.ok) {
				const meData = await meResponse.json();
				if (meData.twoFAEnabled) {
					this.goTo("/home");
					return;
				}
			}
			const response = await TwoFAService.setup2FA();

			const img = document.getElementById("qrImage") as HTMLImageElement;
			img.src = response.qrCode;

			const codeInput = document.getElementById("setup2faCode") as HTMLInputElement;
			const btn = document.getElementById("verifySetup2faBtn") as HTMLButtonElement;

			if (btn && codeInput) {
				btn.addEventListener("click", async () => {
					const code = codeInput.value.trim();
					if (!code || code.length !== 6) {
						alert(lang('twofa.verify.enterCodeAlert'));
						return;
					}
					if (!/^\d+$/.test(code)) {
						alert(lang('twofa.setup.codeDigitsOnly'));
						return;
					}

					try {
						await TwoFAService.enable2FA(code);
						alert(lang('twofa.setup.activationSuccess'));
						this.goTo("/home");
					} catch (err: any) {
						const errorKey = err.message;
						alert(lang(errorKey) || errorKey);
					}
				});
			}
		} catch (err: any) {
			alert(lang('twofa.setup.setupError'));
		}
	}

	unmount(): void {

	}
}
