const axios = require('axios');
const readline = require('readline');
const fs = require('fs');
const FormData = require('form-data');
const path = require('path');
const { loadState, saveState } = require('./tokenStore');

const state = loadState();



process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const BASE_URL = 'http://localhost:3000';
const API = {
    register: `${BASE_URL}/api/users/register`,
    login: `${BASE_URL}/api/users/login`,
    me: `${BASE_URL}/profiles/me`,
    friends: `${BASE_URL}/profiles/me/friends`,
    friendAdd: `${BASE_URL}/profiles/me/friends/add`,
    friendRequests: `${BASE_URL}/profiles/me/friends/requests`,
    friendAccept: `${BASE_URL}/profiles/me/friends/requests/accept`,
    matchesMe: `${BASE_URL}/api/matches/me`,
    githubInit: `${BASE_URL}/api/users/auth/github`
};

let ACCESS_TOKEN = state.ACCESS_TOKEN || null;
let SETUP_2FA_TOKEN = state.SETUP_2FA_TOKEN || null;
let TEMP_2FA_TOKEN = state.TEMP_2FA_TOKEN || null;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const ask = (q) =>
    new Promise(res => rl.question(q, answer => res(answer.trim())));

function authHeader() {
    if (!ACCESS_TOKEN)
        throw new Error('Önce login olmalısın.');
    return { Authorization: `Bearer ${ACCESS_TOKEN}` };
}



async function register() {
    console.log('--- REGISTER TEST ---');
    const alias = await ask('Alias: ');
    const password = await ask('Password: ');

    const res = await axios.post(API.register, { alias, password });
    console.log(res.data);
}

async function login() {
    console.log('--- LOGIN TEST ---');
    const alias = await ask('Alias: ');
    const password = await ask('Password: ');

    const res = await axios.post(API.login, { alias, password });

    if (res.data.twoFactorRequired) {
        TEMP_2FA_TOKEN = res.data.tempToken;
        console.log('2FA gerekli.');
        console.log('Temp token alındı. verify2FA ile devam et.');
        return;
    }

    ACCESS_TOKEN = res.data.token;

        saveState({
            ACCESS_TOKEN,
            SETUP_2FA_TOKEN,
            TEMP_2FA_TOKEN
    });
    console.log('Login başarılı');
}

async function verify2FA() {
    console.log('--- 2FA VERIFY LOGIN ---');

    if (!TEMP_2FA_TOKEN)
        throw new Error('Önce 2FA isteyen bir login yapmalısın.');

    const token = await ask('Authenticator kodu (6 haneli): ');

    const res = await axios.post(`${BASE_URL}/api/users/2fa/verify-login`, {
        tempToken: TEMP_2FA_TOKEN,
        token
    });

    ACCESS_TOKEN = res.data.token;
    TEMP_2FA_TOKEN = null;

    saveState({
        ACCESS_TOKEN,
        SETUP_2FA_TOKEN,
        TEMP_2FA_TOKEN
    });

    console.log('2FA doğrulandı, giriş başarılı.');
}

async function getMyProfile() {
    console.log('--- GET MY PROFILE ---');

    const res = await axios.get(API.me, {
        headers: authHeader()
    });

    console.table(res.data.user);
}

async function updateProfile() {
    console.log('--- UPDATE PROFILE ---');

    const alias = await ask('Yeni alias (boş bırakabilirsin): ');
    const password = await ask('Yeni password (boş bırakabilirsin): ');

    const payload = {};
    if (alias) payload.alias = alias;
    if (password) payload.password = password;

    const res = await axios.put(API.me, payload, {
        headers: authHeader()
    });

    console.log(res.data);
}

async function addFriend() {
    console.log('--- ADD FRIEND ---');

    const friendAlias = await ask('Arkadaş alias: ');

    const res = await axios.post(
        API.friendAdd,
        { friendAlias, action: 'add' },
        { headers: authHeader() }
    );

    console.log(res.data);
}

async function listFriendRequests() {
    console.log('--- FRIEND REQUESTS ---');

    const res = await axios.get(API.friendRequests, {
        headers: authHeader()
    });

    console.table(res.data.requests);
}

async function acceptFriend() {
    console.log('--- ACCEPT FRIEND ---');

    const res = await axios.get(API.friendRequests, {
        headers: authHeader()
    });

    if (res.data.requests.length === 0) {
        console.log('Bekleyen istek yok.');
        return;
    }

    console.table(res.data.requests);

    const id = await ask('Kabul edilecek friend_id: ');

    const acceptRes = await axios.put(
        API.friendAccept,
        { friend_id: Number(id) },
        { headers: authHeader() }
    );

    console.log(acceptRes.data);
}

async function listFriends() {
    console.log('--- FRIEND LIST ---');

    const res = await axios.get(API.friends, {
        headers: authHeader()
    });

    console.table(res.data.friends);
}

async function listMyMatches() {
    console.log('--- MATCH HISTORY (/api/matches/me) ---');

    const limit = await ask('Limit (default 20): ');
    const offset = await ask('Offset (default 0): ');

    const params = {
        limit: limit ? Number(limit) : 20,
        offset: offset ? Number(offset) : 0,
    };

    const res = await axios.get(API.matchesMe, {
        headers: authHeader(),
        params,
    });

    const matches = (res.data && res.data.matches) ? res.data.matches : [];
    if (!Array.isArray(matches) || matches.length === 0) {
        console.log('Match bulunamadı.');
        return;
    }

    console.table(matches.map(m => ({
        id: m.id,
        created_at: m.created_at,
        mode: m.mode,
        opponent: m.opponent,
        myScore: m.myScore,
        opponentScore: m.opponentScore,
        result: m.result,
        is_verified: m.is_verified,
        tournament_id: m.tournament_id,
        stage: m.stage,
        placement: m.placement,
    })));
}

async function setup2FA() {
    console.log('--- 2FA SETUP ---');

    const res = await axios.post(
        `${BASE_URL}/api/users/2fa/setup`,
        {},
        { headers: authHeader() }
    );

    SETUP_2FA_TOKEN = res.data.setupToken;

        saveState({
            ACCESS_TOKEN,
            SETUP_2FA_TOKEN,
            TEMP_2FA_TOKEN
    });

    console.log(res.data.message);
    console.log('QR Code (base64) alındı.');
    console.log('Setup Token saklandı.');
}

async function enable2FA() {
    console.log('--- 2FA ENABLE ---');

    if (!SETUP_2FA_TOKEN)
        throw new Error('Önce 2fa setup çalıştırmalısın.');

    const token = await ask('Authenticator kodu (6 haneli): ');

    const res = await axios.post(`${BASE_URL}/api/users/2fa/enable`, {
        setupToken: SETUP_2FA_TOKEN,
        token
    });

        saveState({
            ACCESS_TOKEN,
            SETUP_2FA_TOKEN,
            TEMP_2FA_TOKEN
    });

    console.log(res.data.message);
}

async function uploadAvatar() {
    console.log('--- AVATAR UPLOAD ---');

    const filePath = await ask('Avatar dosya yolu (örn: ./avatar.jpg): ');

    if (!fs.existsSync(filePath)) {
        throw new Error('Dosya bulunamadı.');
    }

    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));

    const res = await axios.post(
        `${BASE_URL}/profiles/me/avatar`,
        form,
        {
            headers: {
                ...authHeader(),
                ...form.getHeaders()
            }
        }
    );

    console.log(res.data);
}

async function githubLogin() {
    console.log('--- GITHUB OAUTH TEST ---');
    console.log('1. Bu linki tarayıcıda aç ve GitHub ile giriş yap:');
    console.log(API.githubInit);
    console.log('\n2. Giriş yaptıktan sonra tarayıcı seni ana sayfaya (localhost/) atacak.');
    console.log('3. Tarayıcıda F12 -> Application -> Cookies kısmından "accessToken" değerini kopyala.');
    
    const token = await ask('\nTokeni buraya yapıştır: ');
    
    if (token) {
        ACCESS_TOKEN = token;
        saveState({ ACCESS_TOKEN, SETUP_2FA_TOKEN, TEMP_2FA_TOKEN });
        console.log('GitHub Login tokeni kaydedildi. Artık "getMyProfile" yapabilirsin.');
    }
}


const authTests = { register, login, githubLogin }
const twoFATests = { setup2FA, verify2FA, enable2FA }
const profileTests = { getMyProfile, updateProfile, uploadAvatar }
const socialTests = { addFriend, listFriendRequests, acceptFriend, listFriends }
const matchTests = { listMyMatches }


const tests = {
  ...authTests,
  ...twoFATests,
  ...profileTests,
    ...socialTests,
    ...matchTests
}


async function main() {
    const testName = process.argv[2];

    if (!testName || !tests[testName]) {
        console.log('Kullanım: node tester.js [test]');
        console.log('Mevcut testler:');
        Object.keys(tests).forEach(t => console.log(' -', t));
        process.exit(1);
    }

    try {
        await tests[testName]();
    } catch (err) {
        if (err.response)
            console.error('Hata: ', err.response.data);
        else
            console.error('Hata: ', err.message);
    } finally {
        rl.close();
    }
}

main();
