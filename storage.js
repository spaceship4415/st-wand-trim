// 설정은 ST 의 settings.json 이 아니라 사용자 파일 폴더의 별도 파일에 둔다
// (data/<사용자>/user/files/st-wand-trim-settings.json). 확장을 지우면 delete 훅이 이 파일을 지운다.
// 브라우저 쪽 확장이 서버에 쓸 수 있는 곳은 ST 의 /api/files 가 여는 이 폴더뿐이다.

const FILE = 'st-wand-trim-settings.json';
/** 예전에 settings.json 의 extension_settings 에 두던 자리 */
const LEGACY_KEY = 'wandTrim';
const SAVE_DELAY = 500;

const ctx = () => SillyTavern.getContext();
const headers = (options) => ctx().getRequestHeaders(options);

let settings = normalize({});
/** 파일을 읽지 못했으면(서버 오류 등) 쓰지 않는다 — 빈 설정으로 좋은 파일을 덮어쓰지 않게 */
let writable = false;
/** @type {ReturnType<typeof setTimeout>|null} */
let saveTimer = null;

function normalize(stored) {
    return {
        hidden: Array.isArray(stored.hidden) ? stored.hidden.filter(k => typeof k === 'string') : [],
        folders: Array.isArray(stored.folders)
            ? stored.folders
                .filter(f => f && typeof f.id === 'string' && typeof f.name === 'string')
                .map(f => ({ id: f.id, name: f.name, order: Array.isArray(f.order) ? f.order.filter(k => typeof k === 'string') : [] }))
            : [],
        /** 폴더 밖 항목의 순서 */
        order: Array.isArray(stored.order) ? stored.order.filter(k => typeof k === 'string') : [],
        folderOf: stored.folderOf && typeof stored.folderOf === 'object' && !Array.isArray(stored.folderOf) ? stored.folderOf : {},
    };
}

function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

export async function loadSettings() {
    try {
        const response = await fetch(`/user/files/${FILE}`, { cache: 'no-store', headers: headers({ omitContentType: true }) });
        const legacy = ctx().extensionSettings[LEGACY_KEY];
        let legacyDone = legacy !== undefined;
        if (response.ok) {
            settings = normalize(await response.json());
        } else if (response.status !== 404) {
            throw new Error(`HTTP ${response.status}`);
        } else if (legacy && typeof legacy === 'object') {
            settings = normalize(legacy);
            legacyDone = await writeFile();
        }
        writable = true;
        // 예전 위치의 값은 파일을 읽었거나 옮겨 쓴 뒤에만 지운다
        if (legacyDone) {
            delete ctx().extensionSettings[LEGACY_KEY];
            ctx().saveSettingsDebounced();
        }
    } catch (error) {
        console.warn('[Wand Trim] 설정 파일을 못 읽음. 이번엔 바꿔도 저장하지 않습니다', error);
    }
    return settings;
}

export function getSettings() {
    return settings;
}

/** @returns {Promise<boolean>} 저장됐는지 */
async function writeFile(keepalive = false) {
    try {
        const body = JSON.stringify({ name: FILE, data: toBase64(JSON.stringify(settings, null, 4)) });
        const response = await fetch('/api/files/upload', {
            method: 'POST',
            headers: headers(),
            body,
            keepalive: keepalive && body.length < 60000,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return true;
    } catch (error) {
        console.error('[Wand Trim] 설정 저장 실패', error);
        return false;
    }
}

export function saveSettings() {
    if (!writable) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        saveTimer = null;
        writeFile();
    }, SAVE_DELAY);
}

// 저장 대기 중에 새로고침·닫기를 하면 바로 보낸다
window.addEventListener('pagehide', () => {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    writeFile(true);
});

/** 확장을 지울 때: 설정 파일과 settings.json 에 남았을 수 있는 예전 설정을 지운다 */
export async function deleteSettingsFile() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    writable = false;
    try {
        const response = await fetch('/api/files/delete', {
            method: 'POST',
            headers: headers(),
            body: JSON.stringify({ path: `user/files/${FILE}` }),
        });
        if (!response.ok && response.status !== 404) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
        console.error('[Wand Trim] 설정 파일 삭제 실패', error);
    }
    delete ctx().extensionSettings[LEGACY_KEY];
}
