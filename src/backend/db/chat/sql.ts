export const CREATE_MESSAGES = `
WITH new_message AS (
  INSERT INTO chat_message (user_id, message)
  VALUES ($1, $2)
  RETURNING *
)
SELECT
  new_message.*,
  users.username,
  users.email
FROM new_message
JOIN users ON users.id = new_message.user_id
`;

export const RECENT_MESSAGES = `
SELECT
  chat_message.*, users.username, users.email
FROM chat_message
JOIN users ON users.id = chat_message.user_id
ORDER BY chat_message.created_at DESC
LIMIT $1
`;