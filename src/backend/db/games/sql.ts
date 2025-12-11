export const LIST = `
  SELECT 
    g.id,
    g.name,
    g.created_by,
    g.state,
    g.max_players,
    g.hidden_joker_rank,
    g.created_at,
    COUNT(gp.id) AS player_count,
    COALESCE(
      json_agg(
        json_build_object(
          'user_id', gp.user_id,
          'username', u.username,
          'email', u.email
        )
      ) FILTER (WHERE gp.id IS NOT NULL),
      '[]'
    ) AS players
  FROM games g
  LEFT JOIN game_players gp ON g.id = gp.game_id
  LEFT JOIN users u ON u.id = gp.user_id
  GROUP BY g.id
  ORDER BY g.created_at DESC
`;

export const GET = `
  SELECT 
    g.id,
    g.name,
    g.created_by,
    g.state,
    g.max_players,
    g.hidden_joker_rank,
    g.created_at,
    COUNT(gp.id) AS player_count,
    COALESCE(
      json_agg(
        json_build_object(
          'user_id', gp.user_id,
          'username', u.username,
          'email', u.email
        )
      ) FILTER (WHERE gp.id IS NOT NULL),
      '[]'
    ) AS players
  FROM games g
  LEFT JOIN game_players gp ON g.id = gp.game_id
  LEFT JOIN users u ON u.id = gp.user_id
  WHERE g.id = $1
  GROUP BY g.id
`;

export const CREATE = `
  INSERT INTO games (name, created_by, state, max_players)
  VALUES ($1, $2, 'waiting', $3)
  RETURNING id, name, created_by, state, max_players, hidden_joker_rank, created_at
`;

export const JOIN = `
  INSERT INTO game_players (game_id, user_id)
  VALUES ($1, $2)
  ON CONFLICT (game_id, user_id) DO NOTHING
`;
