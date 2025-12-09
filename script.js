// ==========================================
// 1. 配置与全局变量
// ==========================================
const BOOKMARK_FOLDER_NAME = "Safari Vibe"; // 书签文件夹名称
const DEFAULT_SITES = [
    { title: 'Google', url: 'https://www.google.com' },
    { title: 'Bilibili', url: 'https://www.bilibili.com' }
];

// API 兼容性处理
const api = window.browser || window.chrome;

let mySites = [];           // 站点数据缓存（从书签读取）
let bookmarkFolderId = null;// 目标书签文件夹ID
let blockedRecents = [];    // 被屏蔽的最近关闭记录
let blockedSuggestions = [];// 被屏蔽的建议
let editingId = null;       // 当前正在编辑的书签ID
let uploadedIconBase64 = null; // 上传图片的临时存储
let dragSrcEl = null;       // 拖拽源元素
let rightClickedSiteId = null; // 右键点击的站点ID

// ==========================================
// 2. 初始化流程
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 基础功能初始化
    setupEvents();
    setupThemeAndBackground();
    setupCollapsibles();
    setupFileUpload();
    loadConfig(); // 加载屏蔽列表和显示设置

    // 核心数据加载
    loadSites();      // 加载书签
    loadSuggestions(); // 加载历史建议
    loadRecent();     // 加载最近关闭

    // 启动实时监听
    setupRealTimeUpdates(); // 监听历史和会话
    setupBookmarkListeners(); // 监听书签变化

    // 延迟执行图标优化（避免阻塞首屏）
    setTimeout(autoDetectHighResIcons, 800);
});

// ==========================================
// 3. 核心功能：书签管理 (个人收藏)
// ==========================================

// 获取或创建目标文件夹 ID
async function getTargetFolderId() {
    if (bookmarkFolderId) return bookmarkFolderId;
    
    // 搜索文件夹
    const results = await api.bookmarks.search({ title: BOOKMARK_FOLDER_NAME });
    // 确保找到的是文件夹（没有 url 属性）
    const folder = results.find(item => !item.url);
    
    if (folder) {
        bookmarkFolderId = folder.id;
    } else {
        // 不存在则创建
        const newFolder = await api.bookmarks.create({ title: BOOKMARK_FOLDER_NAME });
        bookmarkFolderId = newFolder.id;
        // 初始化默认站点
        for (const site of DEFAULT_SITES) {
            await api.bookmarks.create({
                parentId: bookmarkFolderId,
                title: site.title,
                url: site.url
            });
        }
    }
    return bookmarkFolderId;
}

// 从书签加载站点列表
async function loadSites() {
    const folderId = await getTargetFolderId();
    const children = await api.bookmarks.getChildren(folderId);
    
    // 获取本地图标缓存 (因为书签 API 无法存储 Base64 图片)
    let iconCache = {};
    try { iconCache = JSON.parse(localStorage.getItem('siteIconCache') || '{}'); } catch(e){}

    // 转换数据结构
    mySites = children.filter(node => node.url).map(node => ({
        id: node.id,
        title: node.title,
        url: node.url,
        index: node.index, // 用于排序
        customIcon: iconCache[node.url] || null 
    }));

    const grid = document.getElementById('grid');
    grid.innerHTML = ''; 
    
    mySites.forEach(site => {
        const card = makeEl('div', 'site-card');
        card.setAttribute('data-id', site.id);
        card.setAttribute('draggable', 'true');

        // 图标容器
        const iconWrapper = makeEl('div', 'icon-wrapper');
        const img = createIconImg(site.url, site.customIcon, 'site-icon');
        iconWrapper.appendChild(img);
        
        // 标题
        const title = makeEl('div', 'site-title', site.title);

        card.appendChild(iconWrapper);
        card.appendChild(title);

        // 点击事件
        card.onclick = (e) => { window.location.href = site.url; };
        // 右键菜单
        card.oncontextmenu = (e) => { showContextMenu(e, site.id); };

        grid.appendChild(card);
    });
    
    setupDragAndDrop();
}

// 保存站点 (新增或编辑)
async function saveFromModal() {
    const titleInput = document.getElementById('site-title');
    let url = document.getElementById('site-url').value;
    let customIcon = document.getElementById('site-icon-custom').value;
    
    if (uploadedIconBase64) customIcon = uploadedIconBase64;

    if (!url) return alert("请输入网址");
    if (!url.startsWith('http')) url = 'https://' + url;
    if (!titleInput.value.trim()) titleInput.value = new URL(url).hostname;
    const title = titleInput.value;

    // 1. 保存自定义图标到 LocalStorage 缓存
    let iconCache = JSON.parse(localStorage.getItem('siteIconCache') || '{}');
    if (customIcon) {
        iconCache[url] = customIcon;
    }
    localStorage.setItem('siteIconCache', JSON.stringify(iconCache));

    // 2. 操作书签 API
    try {
        if (editingId) {
            // 编辑现有书签
            await api.bookmarks.update(editingId, { title, url });
        } else {
            // 创建新书签
            const folderId = await getTargetFolderId();
            await api.bookmarks.create({
                parentId: folderId,
                title: title,
                url: url
            });
        }
        closeModal();
        // loadSites 会被书签监听器自动触发，这里不需要手动调用
    } catch (e) {
        alert("保存失败: " + e.message);
    }
}

// 删除站点
async function deleteSite(id) {
    try {
        await api.bookmarks.remove(id);
        // 同样由监听器触发刷新
    } catch (e) {
        console.error("删除失败", e);
    }
}

// ==========================================
// 4. 核心功能：建议与最近关闭
// ==========================================

// 加载浏览历史建议
function loadSuggestions() {
    const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    api.history.search({ text: '', startTime: oneWeekAgo, maxResults: 60 }).then(historyItems => {
        const grid = document.getElementById('suggestion-grid');
        grid.innerHTML = '';
        
        // 过滤：已收藏的不再显示在建议里
        const favDomains = new Set(mySites.map(s => getDomain(s.url)));
        const seenDomains = new Set();
        
        let count = 0;
        for (let item of historyItems) {
            if (count >= 12) break;
            if (!item.url || !item.title) continue;
            if (blockedSuggestions.includes(item.url)) continue;
            
            const domain = getDomain(item.url);
            if (seenDomains.has(domain) || favDomains.has(domain)) continue;
            seenDomains.add(domain);
            count++;

            const wrapper = makeEl('div', 'sugg-wrapper');
            const iconUrl = `https://icons.duckduckgo.com/ip3/${domain}.ico`;

            // 删除(屏蔽)按钮
            const delBtn = makeEl('button', 'btn-del-float', '×');
            delBtn.title = "不再显示";
            delBtn.onclick = (e) => {
                e.stopPropagation();
                blockedSuggestions.push(item.url);
                localStorage.setItem('blockedSuggestions', JSON.stringify(blockedSuggestions));
                loadSuggestions();
            };

            // 卡片结构
            const inner = makeEl('div', 'sugg-inner');
            const blurBg = makeEl('div', 'sugg-blur-bg');
            blurBg.style.backgroundImage = `url('${iconUrl}')`;
            
            const content = makeEl('div', 'sugg-content');
            const iconCont = makeEl('div', 'sugg-icon-cont');
            const iconImg = makeEl('img', 'sugg-icon');
            iconImg.src = iconUrl;
            iconImg.onerror = function(){ this.src = getFallbackIcon(); };
            
            const titleEl = makeEl('div', 'sugg-title', item.title);

            iconCont.appendChild(iconImg);
            content.appendChild(iconCont);
            content.appendChild(titleEl);
            inner.appendChild(blurBg);
            inner.appendChild(content);
            wrapper.appendChild(delBtn);
            wrapper.appendChild(inner);

            wrapper.onclick = (e) => { 
                if (!e.target.closest('button')) window.location.href = item.url; 
            };
            grid.appendChild(wrapper);
        }
        if(count === 0) grid.appendChild(makeEl('div', 'empty-tip', '暂无建议'));
    });
}

// 加载最近关闭的标签
async function loadRecent() {
    const list = document.getElementById('recent-list');
    if (!list) return;
    list.innerHTML = '';

    if (!api.sessions || !api.sessions.getRecentlyClosed) {
        list.appendChild(makeEl('div', 'empty-tip', '无法读取会话记录'));
        return;
    }

    try {
        const sessions = await api.sessions.getRecentlyClosed({ maxResults: 25 });
        if (!sessions || sessions.length === 0) {
            list.appendChild(makeEl('div', 'empty-tip', '暂无最近关闭记录'));
            return;
        }

        let allTabs = [];
        sessions.forEach(session => {
            if (session.tab) allTabs.push(session.tab);
            else if (session.window && session.window.tabs) session.window.tabs.forEach(t => allTabs.push(t));
        });

        const extUrl = api.runtime.getURL("");
        let count = 0;

        for (const tab of allTabs) {
            if (count >= 12) break;
            if (!tab.url) continue;
            // 过滤扩展自身页面和空白页
            if (tab.url.startsWith(extUrl) || tab.url === 'about:newtab' || tab.url === 'about:blank') continue;
            if (blockedRecents.includes(tab.url)) continue;

            count++;
            const card = document.createElement('a');
            card.className = 'recent-card';
            card.href = tab.url;

            // 删除按钮
            const delBtn = document.createElement('button');
            delBtn.className = 'btn-del-float';
            delBtn.textContent = "×";
            delBtn.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                blockedRecents.push(tab.url);
                localStorage.setItem('blockedRecents', JSON.stringify(blockedRecents));
                loadRecent(); 
            };

            // 图标
            const iconBox = makeEl('div', 'recent-icon-box');
            let iconSrc = tab.favIconUrl;
            if (!iconSrc || iconSrc.startsWith('chrome:') || iconSrc.startsWith('moz-extension:')) {
                iconSrc = `https://icons.duckduckgo.com/ip3/${new URL(tab.url).hostname}.ico`;
            }
            const img = makeEl('img', 'recent-icon');
            img.src = iconSrc;
            img.onerror = function() { this.src = getFallbackIcon(); };
            iconBox.appendChild(img);

            // 标题
            let tText = tab.title || "无标题";
            if (tText.length > 25) tText = tText.substring(0, 25) + "...";
            const titleDiv = makeEl('div', 'recent-title', tText);

            card.appendChild(delBtn);
            card.appendChild(iconBox);
            card.appendChild(titleDiv);

            // 恢复会话逻辑
            card.onclick = (e) => {
                if (e.target === delBtn) return;
                e.preventDefault();
                if (tab.sessionId) api.sessions.restore(tab.sessionId);
                else window.location.href = tab.url;
            };

            list.appendChild(card);
        }
        if (count === 0) list.appendChild(makeEl('div', 'empty-tip', '记录已清空'));
    } catch (e) {
        console.error(e);
    }
}

// ==========================================
// 5. 实时同步与监听逻辑 (Real-time Sync)
// ==========================================

// 防抖工具函数
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

// 设置历史与会话监听
function setupRealTimeUpdates() {
    // 1. 监听标签关闭 (更新"最近关闭")
    if (api.sessions && api.sessions.onChanged) {
        const refreshRecent = debounce(() => {
            if (document.visibilityState === 'visible') loadRecent();
        }, 500);
        api.sessions.onChanged.addListener(refreshRecent);
    }

    // 2. 监听历史记录 (更新"建议")
    if (api.history) {
        const refreshSuggestions = debounce(() => {
            if (document.visibilityState === 'visible') loadSuggestions();
        }, 1000);
        if (api.history.onVisited) api.history.onVisited.addListener(refreshSuggestions);
        if (api.history.onVisitRemoved) api.history.onVisitRemoved.addListener(refreshSuggestions);
    }

    // 3. 页面可见性兜底刷新 (当你从其他标签页切回来时)
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            loadRecent();
            loadSuggestions();
            // 书签通常不需要这里刷新，因为书签监听器很可靠
        }
    });
}

// 设置书签监听 (实现文件夹实时同步)
function setupBookmarkListeners() {
    const refreshBookmarks = debounce(() => {
        loadSites();
    }, 300);

    // 监听所有可能影响视图的书签事件
    api.bookmarks.onCreated.addListener(refreshBookmarks);
    api.bookmarks.onRemoved.addListener(refreshBookmarks);
    api.bookmarks.onChanged.addListener(refreshBookmarks);
    api.bookmarks.onMoved.addListener(refreshBookmarks);
    api.bookmarks.onChildrenReordered.addListener(refreshBookmarks);
}

// ==========================================
// 6. 拖拽排序 (适配书签)
// ==========================================

function setupDragAndDrop() {
    const cards = document.querySelectorAll('#grid .site-card');
    cards.forEach(card => {
        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragenter', handleDragEnter);
        card.addEventListener('dragover', handleDragOver);
        card.addEventListener('dragleave', handleDragLeave);
        card.addEventListener('drop', handleDrop);
        card.addEventListener('dragend', handleDragEnd);
    });
}
function handleDragStart(e) {
    dragSrcEl = this;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
    this.classList.add('dragging');
}
function handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; return false; }
function handleDragEnter(e) { this.classList.add('drag-over'); }
function handleDragLeave(e) { this.classList.remove('drag-over'); }
function handleDragEnd(e) {
    this.classList.remove('dragging');
    document.querySelectorAll('#grid .site-card').forEach(card => card.classList.remove('drag-over'));
}

async function handleDrop(e) {
    e.stopPropagation();
    if (dragSrcEl !== this) {
        const srcId = dragSrcEl.getAttribute('data-id');
        const targetId = this.getAttribute('data-id');
        const targetSite = mySites.find(s => s.id === targetId);
        
        if (targetSite) {
            try {
                // 调用书签 API 移动位置
                await api.bookmarks.move(srcId, { index: targetSite.index });
                // 监听器会自动触发 loadSites 刷新界面
            } catch(e) {
                console.error("书签移动失败", e);
            }
        }
    }
    return false;
}

// ==========================================
// 7. 辅助工具函数
// ==========================================

// 安全创建 DOM 元素
function makeEl(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text) el.textContent = text;
    return el;
}

// 图标处理逻辑
function createIconImg(siteUrl, customIcon, className) {
    const img = document.createElement('img');
    img.className = className;
    let src = customIcon;
    
    // 1. 优先使用缓存的自定义图标
    if (src) {
        img.src = src;
        return img;
    }

    // 2. 默认尝试 favicon
    try { src = `${new URL(siteUrl).origin}/favicon.ico`; } catch(e){}
    img.src = src;

    // 3. 失败回退链
    img.onerror = () => {
        img.onerror = null;
        // iowen API
        img.src = `https://api.iowen.cn/favicon/${getDomain(siteUrl)}.png`;
        img.onerror = () => {
            // DuckDuckGo API
            img.src = `https://icons.duckduckgo.com/ip3/${getDomain(siteUrl)}.ico`;
            img.onerror = () => { 
                // SVG Fallback
                img.src = getFallbackIcon(); 
            };
        };
    };
    return img;
}

function getDomain(url) { try { return new URL(url).hostname; } catch(e) { return url; } }
function getFallbackIcon() { 
    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%23ddd'%3E%3Crect width='100' height='100' rx='20' fill='%23f2f2f7'/%3E%3Ctext x='50' y='55' font-size='40' text-anchor='middle' fill='%23999'%3E%F0%9F%8C%90%3C/text%3E%3C/svg%3E"; 
}

// ==========================================
// 8. 界面交互 (弹窗、菜单、配置)
// ==========================================

function showContextMenu(e, siteId) {
    e.preventDefault();
    rightClickedSiteId = siteId;
    const menu = document.getElementById('context-menu');
    menu.classList.remove('hidden');
    let x = e.clientX; let y = e.clientY;
    const rect = menu.getBoundingClientRect();
    if (x + rect.width > window.innerWidth) x -= rect.width;
    if (y + rect.height > window.innerHeight) y -= rect.height;
    menu.style.left = `${x}px`; menu.style.top = `${y}px`;
}
function hideContextMenu() { document.getElementById('context-menu').classList.add('hidden'); }

function openModal(site = null) {
    const modal = document.getElementById('modal');
    modal.classList.remove('hidden');
    editingId = site ? site.id : null;
    document.getElementById('site-title').value = site ? site.title : '';
    document.getElementById('site-url').value = site ? site.url : '';
    
    const urlInput = document.getElementById('site-icon-custom');
    urlInput.value = site ? (site.customIcon && !site.customIcon.startsWith('data:') ? site.customIcon : '') : '';
    urlInput.disabled = false;
    urlInput.placeholder = "粘贴图片 URL";
    document.getElementById('file-status').innerText = "";
    uploadedIconBase64 = null;
    document.getElementById('url-status').innerText = "";
}
function closeModal() { document.getElementById('modal').classList.add('hidden'); }

function loadConfig() {
    try {
        blockedRecents = JSON.parse(localStorage.getItem('blockedRecents') || '[]');
        blockedSuggestions = JSON.parse(localStorage.getItem('blockedSuggestions') || '[]');
    } catch (e) {}

    const checkAutohide = document.getElementById('check-autohide');
    const toolbar = document.querySelector('.toolbar');
    const isAutohide = localStorage.getItem('toolbarAutoHide') === 'true';
    if (checkAutohide) {
        checkAutohide.checked = isAutohide;
        toolbar.classList.toggle('auto-hide', isAutohide);
        checkAutohide.onchange = () => {
            const val = checkAutohide.checked;
            localStorage.setItem('toolbarAutoHide', val);
            toolbar.classList.toggle('auto-hide', val);
        };
    }
    
    ['favorites', 'suggestions', 'recent'].forEach(sec => {
        const isShown = localStorage.getItem(`show_${sec}`) !== 'false';
        const checkbox = document.getElementById(`check-${sec}`);
        const sectionEl = document.getElementById(`section-${sec}`);
        if (checkbox) {
            checkbox.checked = isShown;
            sectionEl.classList.toggle('section-hidden', !isShown);
            checkbox.onchange = () => {
                localStorage.setItem(`show_${sec}`, checkbox.checked);
                sectionEl.classList.toggle('section-hidden', !checkbox.checked);
            };
        }
        if (localStorage.getItem(`collapse_${sec}`) === 'true') {
            document.getElementById(`section-${sec}`).classList.add('collapsed');
        }
    });
}

function setupEvents() {
    document.getElementById('cancel-btn').onclick = closeModal;
    document.getElementById('save-btn').onclick = saveFromModal;
    document.getElementById('modal').onclick = (e) => { if(e.target === document.getElementById('modal')) closeModal(); };
    document.getElementById('tool-refresh').onclick = forceRefreshIcons;
    
    const menu = document.getElementById('toolbar-menu'), toggleBtn = document.getElementById('toolbar-toggle');
    toggleBtn.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); };
    document.getElementById('tool-add').onclick = () => { menu.classList.add('hidden'); openModal(); };
    
    document.getElementById('ctx-edit').onclick = () => {
        hideContextMenu();
        const site = mySites.find(s => s.id === rightClickedSiteId);
        if(site) openModal(site);
    };
    document.getElementById('ctx-delete').onclick = () => {
        hideContextMenu();
        if(confirm('确定删除吗？(将同步删除书签)')) deleteSite(rightClickedSiteId);
    };

    document.addEventListener('click', (e) => {
        if (!menu.classList.contains('hidden') && !menu.contains(e.target) && !toggleBtn.contains(e.target)) {
            menu.classList.add('hidden');
        }
        hideContextMenu();
    });
    document.addEventListener('scroll', hideContextMenu);
    setupAutoTitle();
}

function setupCollapsibles() {
    document.querySelectorAll('.group-header').forEach(header => {
        header.addEventListener('click', () => {
            const targetId = header.getAttribute('data-target');
            const section = document.getElementById(`section-${targetId}`);
            section.classList.toggle('collapsed');
            localStorage.setItem(`collapse_${targetId}`, section.classList.contains('collapsed'));
        });
    });
}

// 主题与背景设置
function setupThemeAndBackground() {
    const savedMode = localStorage.getItem('themeMode') || 'auto';
    applyTheme(savedMode);
    document.querySelectorAll('.theme-btn').forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const mode = btn.dataset.mode;
            localStorage.setItem('themeMode', mode);
            applyTheme(mode);
        };
    });
    setupBgUpload('bg-file-light', 'bg_light');
    setupBgUpload('bg-file-dark', 'bg_dark');
    document.getElementById('bg-reset').onclick = () => {
        if(confirm('恢复默认背景？')) {
            localStorage.removeItem('bg_light');
            localStorage.removeItem('bg_dark');
            applyTheme(localStorage.getItem('themeMode') || 'auto');
        }
    };
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if ((localStorage.getItem('themeMode') || 'auto') === 'auto') applyTheme('auto');
    });
}

function applyTheme(mode) {
    document.querySelectorAll('.theme-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.mode === mode));
    document.body.classList.remove('theme-light', 'theme-dark');
    if (mode !== 'auto') document.body.classList.add(`theme-${mode}`);
    
    let isDark = false;
    if (mode === 'dark') isDark = true;
    else if (mode === 'auto') isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    const bgKey = isDark ? 'bg_dark' : 'bg_light';
    const bgData = localStorage.getItem(bgKey);
    if (bgData) document.body.style.backgroundImage = `url(${bgData})`;
    else document.body.style.backgroundImage = '';
}

function setupBgUpload(inputId, storageKey) {
    const input = document.getElementById(inputId);
    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) { alert("壁纸太大 (>4MB)"); return; }
        const reader = new FileReader();
        reader.onload = (evt) => {
            localStorage.setItem(storageKey, evt.target.result);
            applyTheme(localStorage.getItem('themeMode') || 'auto');
            alert("壁纸设置成功");
        };
        reader.readAsDataURL(file);
    });
}

// 文件上传与图片处理
function setupFileUpload() {
    const fileInput = document.getElementById('site-icon-file');
    const statusDiv = document.getElementById('file-status');
    const urlInput = document.getElementById('site-icon-custom');
    
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) { alert("图片太大了 (<2MB)"); return; }
        
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = 180; canvas.height = 180;
                ctx.drawImage(img, 0, 0, 180, 180);
                uploadedIconBase64 = canvas.toDataURL('image/png', 0.8);
                statusDiv.innerText = `已选择: ${file.name}`;
                urlInput.value = ""; urlInput.disabled = true; urlInput.placeholder = "使用本地上传图片";
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    });
}

async function fetchTitle(url) {
    if (!url.startsWith('http')) url = 'https://' + url;
    try {
        if (api.history && api.history.search) {
            const results = await api.history.search({ text: url, maxResults: 1 });
            if (results && results.length > 0 && results[0].title) return results[0].title;
        }
    } catch(e) {}
    try {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 2000);
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(id);
        if (resp.ok) {
            const text = await resp.text();
            const doc = new DOMParser().parseFromString(text, 'text/html');
            const docTitle = doc.querySelector('title');
            if (docTitle && docTitle.textContent) return docTitle.textContent;
        }
    } catch (e) {}
    try { return new URL(url).hostname; } catch(e){ return url; }
}

function setupAutoTitle() {
    const urlInput = document.getElementById('site-url');
    const titleInput = document.getElementById('site-title');
    const statusSpan = document.getElementById('url-status');
    urlInput.addEventListener('blur', async () => {
        const url = urlInput.value.trim();
        if (!url || titleInput.value.trim() !== '') return;
        statusSpan.innerText = "正在分析...";
        const title = await fetchTitle(url);
        if (!titleInput.value.trim()) titleInput.value = title;
        statusSpan.innerText = "";
    });
}

// 简化的自动图标嗅探（仅在点击刷新时尝试更新缓存）
async function fetchBestIcon(targetUrl) {
    return `https://www.google.com/s2/favicons?domain=${new URL(targetUrl).hostname}&sz=128`;
}

function autoDetectHighResIcons() {
    // 页面加载时留空，节省资源，依赖本地缓存
}

async function forceRefreshIcons() {
    const btn = document.getElementById('tool-refresh');
    const old = btn.innerText;
    btn.innerText = "正在嗅探...";
    btn.disabled = true;

    let iconCache = JSON.parse(localStorage.getItem('siteIconCache') || '{}');
    const promises = mySites.map(async (site) => {
        if (!site.customIcon) {
            const best = await fetchBestIcon(site.url);
            if (best) iconCache[site.url] = best;
        }
    });

    await Promise.all(promises);
    localStorage.setItem('siteIconCache', JSON.stringify(iconCache));
    loadSites(); // 重新加载以应用图标

    setTimeout(() => { btn.innerText = old; btn.disabled = false; }, 1000);
}