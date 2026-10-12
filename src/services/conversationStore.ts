import { VoiceTurn } from '../types/chat';

const MAX_HISTORY_TURNS = 16;

export class ConversationStore {
  private turns: VoiceTurn[] = [];

  public getTurns(): VoiceTurn[] {
    return [...this.turns];
  }

  public addUserAndAssistantTurn(userText: string, assistantText: string): void {
    this.turns.push({ role: 'user', content: userText.trim() });
    this.turns.push({ role: 'assistant', content: assistantText.trim() });
    if (this.turns.length > MAX_HISTORY_TURNS) {
      this.turns = this.turns.slice(-MAX_HISTORY_TURNS);
    }
  }

  public buildRequestMessages(newUserText: string): VoiceTurn[] {
    return [
      ...this.turns.slice(-(MAX_HISTORY_TURNS - 1)),
      { role: 'user', content: newUserText.trim() },
    ];
  }

  public clear(): void {
    this.turns = [];
  }
}
