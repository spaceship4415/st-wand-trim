// 마법봉 메뉴 정리: 안 쓰는 항목 숨기기 + 폴더로 묶기.
// 다른 확장의 DOM은 옮기지 않는다. 컨테이너를 display: contents 로 펴고 CSS order 로만 배치한다.

import { deleteSettingsFile, getSettings, loadSettings, saveSettings } from './storage.js';

const TOGGLE_ID = 'wandtrim_toggle';
const PANEL_ID = 'wandtrim_panel';
/** 편집 중 줄 오른쪽 이만큼(눈 아이콘 자리)을 누르면 패널 대신 숨김/보임만 바꾼다 */
const EYE_HIT_WIDTH = 50;
/** 편집 중 폴더 안 항목의 왼쪽 이만큼(손잡이 자리)을 끌면 순서를 바꾼다 */
const HANDLE_HIT_WIDTH = 44;
/** 끌다가 메뉴 위·아래 끝에서 이만큼 안에 들어오면 메뉴를 스크롤한다 */
const AUTO_SCROLL_EDGE = 40;
const ROW_SELECTOR = ':scope > .extension_container > div, :scope > div:not(.extension_container)';

/** 펼친 폴더 (새로고침하면 다시 접힘) */
const openFolders = new Set();
/** 편집 중 패널을 연 대상: 항목 key 또는 'folder:<id>' */
let selected = null;
/** 손잡이로 끄는 중인 항목 */
let drag = null;

function rowKey(row) {
    return row.id || `text:${row.textContent.trim()}`;
}

function rows(menu) {
    return [...menu.querySelectorAll(ROW_SELECTOR)].filter(row => !row.classList.contains('wandtrim-own'));
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function folderHeader(folder) {
    return document.getElementById(`wandtrim_folder_${folder.id}`);
}

/** 설정에 맞춰 폴더 머리줄을 만들고 지운다 */
function syncFolderHeaders(menu) {
    const { folders } = getSettings();
    const ids = new Set(folders.map(f => f.id));
    for (const el of menu.querySelectorAll(':scope > .wandtrim-folder')) {
        if (!ids.has(el.dataset.folder)) el.remove();
    }
    for (const folder of folders) {
        let el = folderHeader(folder);
        if (!el) {
            el = document.createElement('div');
            el.id = `wandtrim_folder_${folder.id}`;
            el.className = 'wandtrim-own wandtrim-folder list-group-item flex-container flexGap5 interactable';
            el.dataset.folder = folder.id;
            el.tabIndex = 0;
            el.innerHTML = '<div class="fa-fw fa-solid fa-folder extensionsMenuExtensionButton"></div><span class="wandtrim-folder-name"></span><i class="wandtrim-chevron fa-solid fa-chevron-down"></i>';
            menu.append(el);
        }
        const name = el.querySelector('.wandtrim-folder-name');
        if (name.textContent !== folder.name) name.textContent = folder.name;
    }
}

/** 폴더 안 항목을 폴더에 저장된 순서대로. 순서에 없는 항목(새로 넣은 것)은 원래 메뉴 순서로 뒤에 */
function sortInFolder(folder, list) {
    const rank = key => {
        const i = folder.order.indexOf(key);
        return i < 0 ? Infinity : i;
    };
    return list
        .map((row, i) => ({ row, i, r: rank(rowKey(row)) }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map(x => x.row);
}

function folderMembers(menu, folder) {
    const { folderOf } = getSettings();
    return sortInFolder(folder, rows(menu).filter(row => folderOf[rowKey(row)] === folder.id));
}

function apply(menu) {
    const s = getSettings();
    syncFolderHeaders(menu);

    const hidden = new Set(s.hidden);
    const folderIds = new Set(s.folders.map(f => f.id));
    const members = new Map(s.folders.map(f => [f.id, []]));
    const editing = menu.classList.contains('wandtrim-editing');
    let order = 0;

    for (const row of rows(menu)) {
        const key = rowKey(row);
        row.toggleAttribute('data-wandtrim-off', hidden.has(key));
        const folderId = s.folderOf[key];
        const inFolder = folderIds.has(folderId);
        row.toggleAttribute('data-wandtrim-in-folder', inFolder);
        if (inFolder) {
            members.get(folderId).push(row);
        } else {
            row.removeAttribute('data-wandtrim-closed');
            row.style.order = String(order += 2);
        }
    }

    for (const folder of s.folders) {
        const header = folderHeader(folder);
        const open = editing || openFolders.has(folder.id);
        const list = sortInFolder(folder, members.get(folder.id));
        header.style.order = String(order += 2);
        header.toggleAttribute('data-wandtrim-open', open);
        // 숨긴 것만 들어 있거나 빈 폴더는 평소엔 안 보이게
        header.toggleAttribute('data-wandtrim-empty', !list.some(r => !hidden.has(rowKey(r))));
        for (const row of list) {
            row.toggleAttribute('data-wandtrim-closed', !open);
            row.style.order = String(order += 2);
        }
    }

    const toggle = document.getElementById(TOGGLE_ID);
    if (toggle) toggle.style.order = String(order += 2);

    const panel = document.getElementById(PANEL_ID);
    if (panel) {
        const target = selectedElement(menu);
        panel.hidden = !editing || !target;
        if (target) panel.style.order = String(Number(target.style.order) + 1);
    }
}

function selectedElement(menu) {
    if (!selected) return null;
    if (selected.startsWith('folder:')) {
        return document.getElementById(`wandtrim_folder_${selected.slice(7)}`);
    }
    return rows(menu).find(row => rowKey(row) === selected) ?? null;
}

function chip(action, label, { value = '', active = false, icon = '' } = {}) {
    const i = icon ? `<i class="fa-solid ${icon}"></i>` : '';
    return `<div class="wandtrim-chip menu_button${active ? ' active' : ''}" data-action="${action}" data-value="${escapeHtml(value)}">${i}<span>${escapeHtml(label)}</span></div>`;
}

function renderPanel(menu) {
    const panel = document.getElementById(PANEL_ID);
    const s = getSettings();
    if (!selected) {
        panel.innerHTML = '';
    } else if (selected.startsWith('folder:')) {
        const id = selected.slice(7);
        const index = s.folders.findIndex(f => f.id === id);
        const folder = s.folders[index];
        if (!folder) {
            selected = null;
            panel.innerHTML = '';
        } else {
            panel.innerHTML = `
                <div class="wandtrim-panel-row">
                    <input class="text_pole wandtrim-input" data-enter="rename" value="${escapeHtml(folder.name)}" placeholder="폴더 이름">
                    ${chip('rename', '이름 바꾸기')}
                </div>
                <div class="wandtrim-panel-row">
                    ${index > 0 ? chip('folder-up', '위로', { icon: 'fa-arrow-up' }) : ''}
                    ${index < s.folders.length - 1 ? chip('folder-down', '아래로', { icon: 'fa-arrow-down' }) : ''}
                    ${chip('folder-delete', '폴더 지우기', { icon: 'fa-trash-can' })}
                </div>
                <div class="wandtrim-hint">폴더를 지우면 안에 있던 항목은 밖으로 나옵니다.</div>`;
        }
    } else {
        const folder = s.folders.find(f => f.id === s.folderOf[selected]);
        const current = folder ? folder.id : '';
        panel.innerHTML = `
            <div class="wandtrim-label">폴더</div>
            <div class="wandtrim-panel-row">
                ${chip('move', '폴더 밖', { active: !current })}
                ${s.folders.map(f => chip('move', f.name, { value: f.id, active: current === f.id, icon: 'fa-folder' })).join('')}
            </div>
            <div class="wandtrim-panel-row">
                <input class="text_pole wandtrim-input" data-enter="new-folder" placeholder="새 폴더 이름">
                ${chip('new-folder', '만들어 넣기', { icon: 'fa-folder-plus' })}
            </div>`;
    }
    apply(menu);
}

function setEditing(menu, on) {
    menu.classList.toggle('wandtrim-editing', on);
    if (!on) selected = null;
    const label = document.querySelector(`#${TOGGLE_ID} span`);
    if (label) label.textContent = on ? '정리 끝내기' : '메뉴 정리';
    renderPanel(menu);
}

function toggleHidden(menu, key) {
    const s = getSettings();
    s.hidden = s.hidden.includes(key) ? s.hidden.filter(k => k !== key) : [...s.hidden, key];
    saveSettings();
    apply(menu);
}

function runAction(menu, action, value) {
    const s = getSettings();
    const input = document.querySelector(`#${PANEL_ID} .wandtrim-input`);
    const typed = input?.value.trim() ?? '';

    switch (action) {
        case 'move':
            // 다른 폴더로 옮기면 예전 폴더의 순서에서 빼서, 다시 넣을 때 맨 뒤로 가게
            for (const f of s.folders) f.order = f.order.filter(k => k !== selected);
            if (value) s.folderOf[selected] = value;
            else delete s.folderOf[selected];
            break;
        case 'new-folder': {
            if (!typed) {
                input?.focus();
                return;
            }
            const id = Date.now().toString(36);
            for (const f of s.folders) f.order = f.order.filter(k => k !== selected);
            s.folders.push({ id, name: typed, order: [] });
            s.folderOf[selected] = id;
            break;
        }
        case 'rename': {
            const folder = s.folders.find(f => `folder:${f.id}` === selected);
            if (!folder || !typed) return;
            folder.name = typed;
            break;
        }
        case 'folder-up':
        case 'folder-down': {
            const i = s.folders.findIndex(f => `folder:${f.id}` === selected);
            const j = action === 'folder-up' ? i - 1 : i + 1;
            if (i < 0 || j < 0 || j >= s.folders.length) return;
            [s.folders[i], s.folders[j]] = [s.folders[j], s.folders[i]];
            break;
        }
        case 'folder-delete': {
            const id = selected.slice(7);
            s.folders = s.folders.filter(f => f.id !== id);
            for (const [key, folderId] of Object.entries(s.folderOf)) {
                if (folderId === id) delete s.folderOf[key];
            }
            openFolders.delete(id);
            selected = null;
            break;
        }
        default:
            return;
    }
    saveSettings();
    renderPanel(menu);
}

/** 편집 중 폴더 안 항목의 손잡이 자리를 눌렀으면 그 항목 */
function handleRowAt(menu, target, clientX) {
    if (!menu.classList.contains('wandtrim-editing')) return null;
    const row = rows(menu).find(r => r.contains(target));
    if (!row || !row.hasAttribute('data-wandtrim-in-folder')) return null;
    return clientX - row.getBoundingClientRect().left <= HANDLE_HIT_WIDTH ? row : null;
}

function startDrag(menu, row, event) {
    const { folders, folderOf } = getSettings();
    const folder = folders.find(f => f.id === folderOf[rowKey(row)]);
    if (!folder) return;
    if (selected) {
        selected = null;
        renderPanel(menu);
    }
    drag = { menu, row, folder, pointerId: event.pointerId, grabY: event.clientY - row.getBoundingClientRect().top, lastY: event.clientY };
    row.classList.add('wandtrim-dragging');
    row.setPointerCapture?.(event.pointerId);
}

function moveDrag(clientY) {
    const { menu, row, folder } = drag;
    drag.lastY = clientY;

    // 손가락 위치보다 가운데가 위에 있는 다른 항목 수 = 들어갈 자리
    const others = folderMembers(menu, folder).filter(r => r !== row);
    const index = others.filter(r => {
        const rect = r.getBoundingClientRect();
        return rect.top + rect.height / 2 < clientY;
    }).length;
    const keys = others.map(rowKey);
    keys.splice(index, 0, rowKey(row));
    const before = folderMembers(menu, folder).map(rowKey);
    if (keys.some((key, i) => key !== before[i])) {
        folder.order = keys;
        apply(menu);
    }

    // 자리를 바꾼 뒤의 원래 위치를 기준으로 손가락을 따라가게
    const current = Number(row.style.getPropertyValue('--wandtrim-drag-y').replace('px', '')) || 0;
    const naturalTop = row.getBoundingClientRect().top - current;
    row.style.setProperty('--wandtrim-drag-y', `${clientY - drag.grabY - naturalTop}px`);

    const box = menu.getBoundingClientRect();
    if (clientY < box.top + AUTO_SCROLL_EDGE) menu.scrollTop -= 8;
    else if (clientY > box.bottom - AUTO_SCROLL_EDGE) menu.scrollTop += 8;
}

function endDrag() {
    const { menu, row } = drag;
    row.classList.remove('wandtrim-dragging');
    row.style.removeProperty('--wandtrim-drag-y');
    drag = null;
    saveSettings();
    apply(menu);
}

async function init() {
    await loadSettings();

    const menu = document.getElementById('extensionsMenu');
    if (!menu) {
        console.warn('[Wand Trim] 마법봉 메뉴를 못 찾음');
        return;
    }
    menu.classList.add('wandtrim');

    const toggle = document.createElement('div');
    toggle.id = TOGGLE_ID;
    toggle.className = 'wandtrim-own list-group-item flex-container flexGap5 interactable';
    toggle.tabIndex = 0;
    toggle.innerHTML = '<div class="fa-fw fa-solid fa-sliders extensionsMenuExtensionButton"></div><span>메뉴 정리</span>';

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'wandtrim-own';
    panel.hidden = true;

    menu.append(toggle, panel);

    // 캡처 단계에서 가로채서 편집 중엔 원래 동작도, 메뉴 닫힘도 안 일어나게
    menu.addEventListener('click', (event) => {
        const target = /** @type {HTMLElement} */ (event.target);
        const editing = menu.classList.contains('wandtrim-editing');
        const stop = () => {
            event.stopImmediatePropagation();
            if (!target.matches('input')) event.preventDefault();
        };

        if (target.closest(`#${TOGGLE_ID}`)) {
            stop();
            setEditing(menu, !editing);
            return;
        }

        if (target.closest(`#${PANEL_ID}`)) {
            stop();
            const button = target.closest('[data-action]');
            if (button) runAction(menu, button.dataset.action, button.dataset.value);
            return;
        }

        const header = target.closest('.wandtrim-folder');
        if (header) {
            stop();
            const id = header.dataset.folder;
            if (editing) {
                selected = selected === `folder:${id}` ? null : `folder:${id}`;
                renderPanel(menu);
            } else {
                if (openFolders.has(id)) openFolders.delete(id);
                else openFolders.add(id);
                apply(menu);
            }
            return;
        }

        if (!editing) return;
        const row = rows(menu).find(r => r.contains(target));
        if (!row) return;
        stop();
        // 손잡이는 끌기 전용. 그냥 눌렀을 땐 아무것도 안 한다
        if (event.clientX && handleRowAt(menu, target, event.clientX)) return;
        const key = rowKey(row);
        // 키보드로 누르면 좌표가 없으니(clientX 0) 패널 쪽으로 간다
        if (event.clientX && row.getBoundingClientRect().right - event.clientX <= EYE_HIT_WIDTH) {
            toggleHidden(menu, key);
            return;
        }
        selected = selected === key ? null : key;
        renderPanel(menu);
    }, true);

    // 손잡이에서 시작한 터치는 메뉴 스크롤이 아니라 끌기로 (passive: false 여야 막을 수 있다)
    menu.addEventListener('touchstart', (event) => {
        const touch = event.touches[0];
        if (touch && handleRowAt(menu, /** @type {HTMLElement} */ (event.target), touch.clientX)) event.preventDefault();
    }, { passive: false, capture: true });

    menu.addEventListener('pointerdown', (event) => {
        if (drag || event.button > 0) return;
        const row = handleRowAt(menu, /** @type {HTMLElement} */ (event.target), event.clientX);
        if (!row) return;
        event.preventDefault();
        startDrag(menu, row, event);
    }, true);

    menu.addEventListener('pointermove', (event) => {
        if (drag && event.pointerId === drag.pointerId) moveDrag(event.clientY);
    }, true);

    for (const type of ['pointerup', 'pointercancel']) {
        menu.addEventListener(type, (event) => {
            if (drag && event.pointerId === drag.pointerId) endDrag();
        }, true);
    }

    menu.addEventListener('keydown', (event) => {
        const target = /** @type {HTMLElement} */ (event.target);
        if (event.key !== 'Enter' || !target.matches('.wandtrim-input')) return;
        event.preventDefault();
        event.stopPropagation();
        runAction(menu, target.dataset.enter, '');
    });

    new MutationObserver(() => apply(menu)).observe(menu, { childList: true, subtree: true });

    // 바깥을 눌러 메뉴가 닫히면 편집 모드도 끝
    new MutationObserver(() => {
        if (menu.style.display === 'none' && menu.classList.contains('wandtrim-editing')) setEditing(menu, false);
    }).observe(menu, { attributes: true, attributeFilter: ['style'] });

    apply(menu);
}

/** 확장을 지울 때 ST 가 부르는 훅(manifest.json 의 hooks.delete) */
export async function onDelete() {
    await deleteSettingsFile();
}

jQuery(init);
