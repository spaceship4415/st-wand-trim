// 마법봉 메뉴 정리: 안 쓰는 항목 숨기기 + 폴더로 묶기.
// 다른 확장의 DOM은 옮기지 않는다. 컨테이너를 display: contents 로 펴고 CSS order 로만 배치한다.

import { deleteSettingsFile, getSettings, loadSettings, saveSettings } from './storage.js';

const TOGGLE_ID = 'wandtrim_toggle';
const PANEL_ID = 'wandtrim_panel';
/** 편집 중 줄 오른쪽 이만큼(눈 아이콘 자리)을 누르면 패널 대신 숨김/보임만 바꾼다 */
const EYE_HIT_WIDTH = 50;
/** 편집 중 줄 왼쪽 이만큼(손잡이 자리)을 끌면 옮긴다 */
const HANDLE_HIT_WIDTH = 44;
/** 끌다가 메뉴 위·아래 끝에서 이만큼 안에 들어오면 메뉴를 스크롤한다 */
const AUTO_SCROLL_EDGE = 40;
/** 메뉴 윗끝과 화면 위 사이에 남길 틈 */
const FIT_MARGIN = 8;
const ROW_SELECTOR = ':scope > .extension_container > div, :scope > div:not(.extension_container)';

/** 펼친 폴더 (새로고침하면 다시 접힘) */
const openFolders = new Set();
/** 편집 중 패널을 연 대상: 항목 key 또는 'folder:<id>' */
let selected = null;
/** 손잡이로 끄는 중인 줄(항목 또는 폴더) */
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

/** 저장된 순서대로. 순서에 없는 항목(새로 넣은 것)은 원래 메뉴 순서로 뒤에 */
function sortByOrder(order, list) {
    const rank = key => {
        const i = order.indexOf(key);
        return i < 0 ? Infinity : i;
    };
    return list
        .map((row, i) => ({ row, i, r: rank(rowKey(row)) }))
        .sort((a, b) => a.r - b.r || a.i - b.i)
        .map(x => x.row);
}

/** 그 폴더에 든 항목을 순서대로. folderId 가 '' 면 폴더 밖 항목 */
function members(menu, folderId) {
    const s = getSettings();
    const folder = s.folders.find(f => f.id === folderId);
    const inside = row => {
        const id = s.folderOf[rowKey(row)];
        return folder ? id === folder.id : !s.folders.some(f => f.id === id);
    };
    return sortByOrder(folder ? folder.order : s.order, rows(menu).filter(inside));
}

function apply(menu) {
    const s = getSettings();
    syncFolderHeaders(menu);

    const hidden = new Set(s.hidden);
    const folderIds = new Set(s.folders.map(f => f.id));
    const grouped = new Map(s.folders.map(f => [f.id, []]));
    const loose = [];
    const editing = menu.classList.contains('wandtrim-editing');
    let order = 0;

    for (const row of rows(menu)) {
        const key = rowKey(row);
        row.toggleAttribute('data-wandtrim-off', hidden.has(key));
        const folderId = s.folderOf[key];
        const inFolder = folderIds.has(folderId);
        row.toggleAttribute('data-wandtrim-in-folder', inFolder);
        if (inFolder) {
            grouped.get(folderId).push(row);
        } else {
            row.removeAttribute('data-wandtrim-closed');
            loose.push(row);
        }
    }

    for (const row of sortByOrder(s.order, loose)) {
        row.style.order = String(order += 2);
    }

    for (const folder of s.folders) {
        const header = folderHeader(folder);
        const open = editing || openFolders.has(folder.id);
        const list = sortByOrder(folder.order, grouped.get(folder.id));
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

    fitHeight(menu);
}

/**
 * 메뉴는 아래(입력창 위)에 붙어서 위로 자란다. 코어의 최대 높이는 '화면 - 입력창 높이 2개'로 어림하는데,
 * 입력창 위에 툴바가 더 있으면 그보다 높아서 메뉴 윗부분이 화면 밖으로 나가 스크롤로도 못 본다.
 * 그래서 메뉴 아래 끝에서 화면 위까지 실제로 남은 높이로 다시 막는다.
 */
function fitHeight(menu) {
    if (menu.style.display === 'none') return;
    const viewportTop = window.visualViewport?.offsetTop ?? 0;
    const room = Math.floor(menu.getBoundingClientRect().bottom - viewportTop - FIT_MARGIN);
    const value = `${Math.max(room, 120)}px`;
    if (menu.style.getPropertyValue('--wandtrim-max-h') !== value) {
        menu.style.setProperty('--wandtrim-max-h', value);
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
        const folder = s.folders.find(f => f.id === id);
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
            placeItem(menu, selected, value);
            break;
        case 'new-folder': {
            if (!typed) {
                input?.focus();
                return;
            }
            const id = Date.now().toString(36);
            s.folders.push({ id, name: typed, order: [] });
            placeItem(menu, selected, id);
            break;
        }
        case 'rename': {
            const folder = s.folders.find(f => `folder:${f.id}` === selected);
            if (!folder || !typed) return;
            folder.name = typed;
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

/**
 * 항목을 폴더(folderId, '' 면 폴더 밖)의 index 자리에 둔다. index 를 안 주면 맨 뒤.
 * 다른 곳의 순서에서는 빼서, 나중에 그리로 돌아가면 맨 뒤로 가게 한다.
 */
function placeItem(menu, key, folderId, index) {
    const s = getSettings();
    const folder = s.folders.find(f => f.id === folderId);
    const keys = members(menu, folder ? folder.id : '').map(rowKey).filter(k => k !== key);
    keys.splice(index ?? keys.length, 0, key);

    s.order = s.order.filter(k => k !== key);
    for (const f of s.folders) f.order = f.order.filter(k => k !== key);
    if (folder) {
        s.folderOf[key] = folder.id;
        folder.order = keys;
    } else {
        delete s.folderOf[key];
        s.order = keys;
    }
}

/** 줄이 속한 곳: 폴더 id, 폴더 밖이면 '' */
function containerOf(el) {
    if (el.classList.contains('wandtrim-folder')) return el.dataset.folder;
    return el.hasAttribute('data-wandtrim-in-folder') ? getSettings().folderOf[rowKey(el)] : '';
}

/** 지금 화면에 보이는 순서대로 항목 줄과 폴더 줄 (except 는 빼고) */
function visibleEntries(menu, except) {
    return [...rows(menu), ...menu.querySelectorAll(':scope > .wandtrim-folder')]
        .filter(el => el !== except && el.getClientRects().length)
        .sort((a, b) => Number(a.style.order) - Number(b.style.order));
}

/**
 * 끄는 항목을 손가락 높이 y 에 놓으면 어디로 가는지.
 * 폴더 줄 위면 { into: 폴더 id }, 아니면 { folderId, index } (index 없으면 그곳 맨 뒤)
 */
function dropTarget(menu, row, y) {
    const entries = visibleEntries(menu, row);
    for (let i = 0; i < entries.length; i++) {
        const el = entries[i];
        const rect = el.getBoundingClientRect();
        const isFolder = el.classList.contains('wandtrim-folder');
        if (isFolder && y >= rect.top && y <= rect.bottom) return { into: el.dataset.folder };
        if (rect.top + rect.height / 2 <= y) continue;
        if (isFolder) {
            // 폴더 줄보다 위: 바로 위 줄이 있던 곳의 맨 뒤
            return { folderId: i > 0 ? containerOf(entries[i - 1]) : '' };
        }
        const folderId = containerOf(el);
        return { folderId, index: members(menu, folderId).filter(r => r !== row).indexOf(el) };
    }
    const last = entries.at(-1);
    return { folderId: last ? containerOf(last) : '' };
}

/** 편집 중 손잡이 자리를 눌렀으면 끌 줄(항목 또는 폴더) */
function handleAt(menu, target, clientX) {
    if (!menu.classList.contains('wandtrim-editing')) return null;
    const el = target.closest('.wandtrim-folder') ?? rows(menu).find(r => r.contains(target));
    if (!el) return null;
    const left = el.getBoundingClientRect().left + parseFloat(getComputedStyle(el).paddingLeft);
    return clientX - left <= HANDLE_HIT_WIDTH ? el : null;
}

function startDrag(menu, el, event) {
    if (selected) {
        selected = null;
        renderPanel(menu);
    }
    const isFolder = el.classList.contains('wandtrim-folder');
    // 폴더를 끌 땐 안의 항목을 접는다. 접으면 줄 위치가 바뀌니 줄 가운데를 손가락에 맞춘다
    if (isFolder) menu.classList.add('wandtrim-folder-drag');
    const rect = el.getBoundingClientRect();
    drag = {
        menu,
        el,
        isFolder,
        pointerId: event.pointerId,
        grabY: isFolder ? rect.height / 2 : event.clientY - rect.top,
        into: null,
        target: isFolder ? null : JSON.stringify({ folderId: containerOf(el), index: members(menu, containerOf(el)).indexOf(el) }),
    };
    el.classList.add('wandtrim-dragging');
    try {
        // 손가락이 줄 밖으로 나가도 이벤트를 계속 받게
        el.setPointerCapture(event.pointerId);
    } catch {
        // 이미 끝난 포인터면 못 잡는다. 메뉴에 단 리스너로도 대부분 받는다
    }
    moveDrag(event.clientY);
}

function moveFolder(y) {
    const { menu, el } = drag;
    const s = getSettings();
    const others = [...menu.querySelectorAll(':scope > .wandtrim-folder')].filter(h => h !== el);
    const index = others.filter(h => {
        const rect = h.getBoundingClientRect();
        return rect.top + rect.height / 2 < y;
    }).length;
    const ids = others.sort((a, b) => Number(a.style.order) - Number(b.style.order)).map(h => h.dataset.folder);
    ids.splice(index, 0, el.dataset.folder);
    if (ids.some((id, i) => id !== s.folders[i].id)) {
        s.folders = ids.map(id => s.folders.find(f => f.id === id));
        apply(menu);
    }
}

function moveItem(y) {
    const { menu, el } = drag;
    const target = dropTarget(menu, el, y);
    const into = target.into ?? null;
    if (into !== drag.into) {
        menu.querySelector('[data-wandtrim-drop]')?.removeAttribute('data-wandtrim-drop');
        if (into) document.getElementById(`wandtrim_folder_${into}`)?.setAttribute('data-wandtrim-drop', '');
        drag.into = into;
    }
    if (into) return;
    // 자리가 바뀔 때만 옮긴다(옮기면 줄이 움직여 손가락 아래 줄이 바뀌니 같은 자리면 그대로)
    const key = JSON.stringify(target);
    if (key === drag.target) return;
    drag.target = key;
    placeItem(menu, rowKey(el), target.folderId, target.index);
    apply(menu);
}

function moveDrag(clientY) {
    const { menu, el } = drag;
    if (drag.isFolder) moveFolder(clientY);
    else moveItem(clientY);

    // 자리를 바꾼 뒤의 원래 위치를 기준으로 손가락을 따라가게
    const current = Number(el.style.getPropertyValue('--wandtrim-drag-y').replace('px', '')) || 0;
    const naturalTop = el.getBoundingClientRect().top - current;
    el.style.setProperty('--wandtrim-drag-y', `${clientY - drag.grabY - naturalTop}px`);

    const box = menu.getBoundingClientRect();
    if (clientY < box.top + AUTO_SCROLL_EDGE) menu.scrollTop -= 8;
    else if (clientY > box.bottom - AUTO_SCROLL_EDGE) menu.scrollTop += 8;
}

function endDrag() {
    const { menu, el, into } = drag;
    if (into) placeItem(menu, rowKey(el), into);
    menu.querySelector('[data-wandtrim-drop]')?.removeAttribute('data-wandtrim-drop');
    menu.classList.remove('wandtrim-folder-drag');
    el.classList.remove('wandtrim-dragging');
    el.style.removeProperty('--wandtrim-drag-y');
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

        // 손잡이는 끌기 전용. 그냥 눌렀을 땐 아무것도 안 한다
        if (event.clientX && handleAt(menu, target, event.clientX)) {
            stop();
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
        if (touch && handleAt(menu, /** @type {HTMLElement} */ (event.target), touch.clientX)) event.preventDefault();
    }, { passive: false, capture: true });

    menu.addEventListener('pointerdown', (event) => {
        if (drag || event.button > 0) return;
        const el = handleAt(menu, /** @type {HTMLElement} */ (event.target), event.clientX);
        if (!el) return;
        event.preventDefault();
        startDrag(menu, el, event);
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
        // 열릴 때(fadeIn)·자리가 바뀔 때(popper)마다 남은 높이를 다시 잰다
        fitHeight(menu);
    }).observe(menu, { attributes: true, attributeFilter: ['style'] });
    window.visualViewport?.addEventListener('resize', () => fitHeight(menu));
    window.addEventListener('resize', () => fitHeight(menu));

    apply(menu);
}

/** 확장을 지울 때 ST 가 부르는 훅(manifest.json 의 hooks.delete) */
export async function onDelete() {
    await deleteSettingsFile();
}

jQuery(init);
