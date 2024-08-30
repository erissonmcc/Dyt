const fetch = require('node-fetch');
const { admin } = require('./firebaseAdmin');

exports.handler = async function(event, context) {
  const code = new URLSearchParams(event.queryStringParameters).get('code');

  if (!code) {
    return {
      statusCode: 400,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ error: 'Código de autorização não fornecido' }),
    };
  }

  try {
    // Obtém o token de acesso do Discord
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
        scope: 'identify email guilds',
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error('Falha ao obter o token de acesso do Discord');
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Obtém as informações do usuário
    const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!userResponse.ok) {
      throw new Error('Falha ao obter as informações do usuário do Discord');
    }

    const userData = await userResponse.json();

    // Verifica se o usuário está no servidor e obtém seus cargos
    const guildResponse = await fetch(`https://discord.com/api/v10/users/@me/guilds/${process.env.DISCORD_GUILD_ID}/member`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!guildResponse.ok) {
      throw new Error('Falha ao verificar a participação no servidor');
    }

    const guildData = await guildResponse.json();
    const isAdmin = guildData.roles.includes(process.env.DISCORD_ADMIN_ROLE_ID);
    console.log('E admin?:', isAdmin);
    // Gera a URL da foto do perfil se o avatar existir
    const photoURL = userData.avatar
      ? `https://cdn.discordapp.com/avatars/${userData.id}/${userData.avatar}.png`
      : undefined;

    // Verifica se o usuário já existe no Firebase, se não, cria o usuário
    let firebaseUser;
    try {
      firebaseUser = await admin.auth().getUser(userData.id);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        firebaseUser = await admin.auth().createUser({
          uid: userData.id,
          email: userData.email,
          displayName: userData.username,
          ...(photoURL && { photoURL }),
        });
      } else {
        throw error;
      }
    }

    // Atualiza o perfil do usuário, se necessário
    await admin.auth().updateUser(userData.id, {
      email: userData.email,
      displayName: userData.username,
      ...(photoURL && { photoURL }),
    });

    // Cria o token personalizado com ou sem o claim 'role=admin'
    const customClaims = isAdmin ? { role: 'admin' } : {};
    const customToken = await admin.auth().createCustomToken(userData.id, customClaims);

    console.log('Token gerado com sucesso:', customToken);
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ token: customToken }),
    };
  } catch (error) {
    console.error('Erro ao autenticar com o Discord:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ error: 'Erro ao autenticar com o Discord' }),
    };
  }
}
