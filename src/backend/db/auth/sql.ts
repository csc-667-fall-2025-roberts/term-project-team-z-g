 export const SIGNUP = `
  INSERT INTO users (username, email, password) 
  VALUES ($1, $2, $3)
  RETURNING id, username, email
`;

export const LOGIN = `
  SELECT * FROM users
  WHERE username=$1
`;