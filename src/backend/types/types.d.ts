export interface User {
  id: number;
  username: string;
  email: string;
  created_at: Date;
}

export interface SecureUser extends User {
  password: string;
}

export interface ChatMessage {
    id: number;
    user_id: number;
    message: string;
    created_at: Date;
}

export interface ChatMessageWithUser extends ChatMessage {
    username: string;
    email: string;
}

export interface Game {
  id: number;
  name: string;
  created_by: number;
  state: string;
  max_players: number;
  hidden_joker_rank?: string;
  created_at: Date;
  player_count?: number;
  players?: Array<{ user_id: number; username: string; email: string }>; 
}