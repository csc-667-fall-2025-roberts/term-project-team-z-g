export const CREATE_GAME_MESSAGE = `
  INSERT INTO messages (game_id, user_id, message)
  VALUES ($1, $2, $3)
  RETURNING id, game_id, user_id, message, created_at;
`;

export const RECENT_GAME_MESSAGES = `
  SELECT m.id, m.game_id, m.user_id, m.message, m.created_at,
         u.username
  FROM messages m
  JOIN users u ON m.user_id = u.id
  WHERE m.game_id = $1
  ORDER BY m.created_at ASC
  LIMIT $2;
`;
