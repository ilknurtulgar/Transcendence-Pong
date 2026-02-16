import { apiUrl } from "./api";

export type MatchResult = "win" | "loss" | "draw" | "unverified";

export type MatchHistoryItem = {
  id: number;
  created_at: string;
  mode: string;
  opponent: string;
  myScore: number | null;
  opponentScore: number | null;
  result: MatchResult;
  is_verified?: boolean;
  winner_alias: string | null;
  tournament_id?: string | null;
  stage?: string | null;
  placement?: number | null;
};

export class MatchService {
  private static API_URL = apiUrl("/api/matches");

  static async getMyMatches(limit = 20, offset = 0): Promise<{ matches: MatchHistoryItem[] } | undefined> {
    try {
      const url = new URL(`${this.API_URL}/me`, window.location.origin);
      url.searchParams.set("limit", String(limit));
      url.searchParams.set("offset", String(offset));

      const response = await fetch(url.toString(), {
        method: "GET",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (response.status === 401) {
        console.warn("Match history: not authenticated");
        return undefined;
      }

      const data = await response.json();
      if (!response.ok) throw new Error(data.errorKey || data.error);
      return data;
    } catch (error) {
      console.error("Match history error:", error);
    }
  }

  static async createMatch(payload: {
    myScore: number;
    opponentScore: number;
    mode: string;
    opponentUserId?: number;
    opponentLabel?: string;
  }): Promise<{ id: number } | undefined> {
    try {
      const response = await fetch(this.API_URL, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.errorKey || data.error);
      return data;
    } catch (error) {
      alert((error as Error).message);
    }
  }
}
