// ==========================================
// SUPABASE CONFIGURATION
// ==========================================
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

let supabaseClient = null;
try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
} catch (e) {
    console.error("Failed to initialize Supabase client:", e);
}

// ==========================================
// STATE MANAGEMENT
// ==========================================
let currentUser = null; // { id, username, avatar }
let peerUser = null;    // { id, username, avatar }
let currentConversationId = null;
let messagesPaginationOffset = 0;
const PAGE_SIZE = 30;

let realtimeChannel = null;
let typingTimeout = null;
let isTypingSent = false;
let presenceChannel = null;

// Built-in Vanilla Emojis
const EMOJI_LIST = [
    '😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰',
    '😘','😗','😙','😚','😋','😛','😝','😜','🤪','🤨','🧐','🤓','😎','🤩','🥳','😏',
    '😒','😞','😔','worried','😕','🙁','☹️','😣','😖','tired','😫','🥱','🥺','Cry',
    '❤️️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❤️‍🔥','❤️️‍🩹','❣️','💕','💞','💓',
    '👍','👎','✊','👊','🤛','🤜','🤞','✌️','🤟','🤘','👌','🤌','🤏','👈','👉','👆',
    '🔥','✨','⭐','🌟','💬','🎉','🚀','💡','👑','💎','🍕','☕','🍺','🎵','🎶','⚽'
];

// ==========================================
// INITIALIZATION ON LOAD
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
    initTheme();
    initEmojiPicker();
    setupTextareaAutoResize();

    // Check active session in localStorage
    const savedUser = localStorage.getItem("duet_current_user");
    if (savedUser) {
        try {
            currentUser = JSON.parse(savedUser);
            await initializeAppSession();
        } catch (err) {
            console.error("Session restore error:", err);
            localStorage.removeItem("duet_current_user");
        }
    }
});

// ==========================================
// AUTHENTICATION & LOGIN
// ==========================================
async function handleLogin(event) {
    event.preventDefault();
    const usernameInput = document.getElementById("username-input").value.trim();
    const passwordInput = document.getElementById("password-input").value;
    const errorDiv = document.getElementById("login-error");
    const loginBtn = document.getElementById("login-btn");

    errorDiv.classList.add("hidden");

    if (!usernameInput || !passwordInput) {
        showError("Please enter both username and password.");
        return;
    }

    if (passwordInput !== "12112") {
        showError("Invalid password. (Hint: 12112)");
        return;
    }

    // Exact username validation (case-insensitive trim check)
    const validNames = ["Krishna Bea", "Yearner"];
    const matchedName = validNames.find(n => n.toLowerCase() === usernameInput.toLowerCase());

    if (!matchedName) {
        showError("Unauthorized username. Only Krishna Bea and Yearner are permitted.");
        return;
    }

    setLoading(loginBtn, true);

    try {
        if (!supabaseClient) throw new Error("Supabase is not configured properly.");

        // Fetch user profile from database
        let { data: profile, error } = await supabaseClient
            .from("profiles")
            .select("*")
            .ilike("username", matchedName)
            .single();

        if (error || !profile) {
            // Auto-bootstrap profile if missing
            const avatarUrl = `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(matchedName)}`;
            const { data: newProfile, createErr } = await supabaseClient
                .from("profiles")
                .insert([{ username: matchedName, avatar_url: avatarUrl, status: "offline" }])
                .select()
                .single();

            if (createErr) throw createErr;
            profile = newProfile;
        }

        currentUser = {
            id: profile.id,
            username: profile.username,
            avatar: profile.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(profile.username)}`
        };

        localStorage.setItem("duet_current_user", JSON.stringify(currentUser));
        await initializeAppSession();

    } catch (err) {
        console.error("Login error:", err);
        showError("Connection error or database setup incomplete. Check Supabase credentials.");
    } finally {
        setLoading(loginBtn, false);
    }
}

function showError(msg) {
    const errorDiv = document.getElementById("login-error");
    errorDiv.textContent = msg;
    errorDiv.classList.remove("hidden");
}

function setLoading(btn, isLoading) {
    const btnText = btn.querySelector(".btn-text");
    const spinner = btn.querySelector(".spinner");
    if (isLoading) {
        btnText.classList.add("hidden");
        spinner.classList.remove("hidden");
        btn.disabled = true;
    } else {
        btnText.classList.remove("hidden");
        spinner.classList.add("hidden");
        btn.disabled = false;
    }
}

async function initializeAppSession() {
    document.getElementById("login-container").classList.add("hidden");
    document.getElementById("app-container").classList.remove("hidden");

    // Populate user profile info
    document.getElementById("my-name").textContent = currentUser.username;
    document.getElementById("my-avatar").src = currentUser.avatar;
    document.getElementById("settings-username-display").textContent = `Logged in as ${currentUser.username}`;

    await loadPeerAndConversation();
    await loadMessages();
    setupRealtimeSubscriptions();
    setupPresence();
}

async function logout() {
    if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
    if (presenceChannel) supabaseClient.removeChannel(presenceChannel);
    localStorage.removeItem("duet_current_user");
    window.location.reload();
}

// ==========================================
// CONVERSATION & PEER SETUP
// ==========================================
async function loadPeerAndConversation() {
    try {
        // Fetch the other user profile
        const { data: profiles, error: profErr } = await supabaseClient
            .from("profiles")
            .select("*")
            .neq("id", currentUser.id);

        if (profErr || !profiles || profiles.length === 0) {
            throw new Error("Peer user profile not found. Run supabase.sql migration.");
        }

        const p = profiles[0];
        peerUser = {
            id: p.id,
            username: p.username,
            avatar: p.avatar_url || `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(p.username)}`
        };

        // Update UI elements with peer info
        document.getElementById("peer-name-sidebar").textContent = peerUser.username;
        document.getElementById("peer-avatar-sidebar").src = peerUser.avatar;
        document.getElementById("peer-name-header").textContent = peerUser.username;
        document.getElementById("peer-avatar-header").src = peerUser.avatar;
        document.getElementById("details-name").textContent = peerUser.username;
        document.getElementById("details-avatar").src = peerUser.avatar;

        // Fetch or create the single conversation between them
        let { data: convs, error: convErr } = await supabaseClient
            .from("conversations")
            .select("id");

        if (convErr || !convs || convs.length === 0) {
            const { data: newConv, createErr } = await supabaseClient
                .from("conversations")
                .insert({})
                .select()
                .single();
            if (createErr) throw createErr;
            currentConversationId = newConv.id;
        } else {
            currentConversationId = convs[0].id;
        }

    } catch (err) {
        console.error("Error loading conversation:", err);
        showToast("Failed to load conversation details.");
    }
}

// ==========================================
// MESSAGING & REALTIME
// ==========================================
async function loadMessages(loadMore = false) {
    if (!currentConversationId) return;

    try {
        const { data: msgs, error } = await supabaseClient
            .from("messages")
            .select("*")
            .eq("conversation_id", currentConversationId)
            .order("created_at", { ascending: false })
            .range(messagesPaginationOffset, messagesPaginationOffset + PAGE_SIZE - 1);

        if (error) throw error;

        const messageList = document.getElementById("message-list");
        if (!loadMore) {
            messageList.innerHTML = "";
        }

        if (msgs && msgs.length > 0) {
            // Sort ascending for display
            const sorted = msgs.reverse();
            sorted.forEach(msg => renderMessage(msg, loadMore));
            
            if (!loadMore) {
                scrollToBottom();
                markMessagesAsRead();
            }
            
            if (msgs.length >= PAGE_SIZE) {
                document.getElementById("load-more-trigger").classList.remove("hidden");
            } else {
                document.getElementById("load-more-trigger").classList.add("hidden");
            }
        }
    } catch (err) {
        console.error("Error loading messages:", err);
    }
}

function loadMoreMessages() {
    messagesPaginationOffset += PAGE_SIZE;
    loadMessages(true);
}

function renderMessage(msg, prepend = false) {
    const messageList = document.getElementById("message-list");
    const isSent = msg.sender_id === currentUser.id;

    const row = document.createElement("div");
    row.className = `message-row ${isSent ? 'sent' : 'received'}`;
    row.setAttribute("data-id", msg.id);

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    if (msg.message_type === "image") {
        const img = document.createElement("img");
        img.src = msg.content;
        img.className = "message-image";
        img.onclick = () => openLightbox(msg.content);
        bubble.appendChild(img);
    } else {
        bubble.textContent = msg.content;
    }

    const meta = document.createElement("div");
    meta.className = "message-meta";
    
    const timeStr = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    let statusIcon = "";
    if (isSent) {
        statusIcon = msg.read ? ' ✓✓' : ' ✓';
    }
    meta.innerHTML = `<span>${timeStr}</span>${isSent ? `<span class="read-status">${statusIcon}</span>` : ''}`;
    
    bubble.appendChild(meta);
    row.appendChild(bubble);

    if (prepend) {
        messageList.insertBefore(row, messageList.firstChild);
    } else {
        messageList.appendChild(row);
    }

    updateSidebarPreview(msg);
}

async function sendMessage() {
    const textarea = document.getElementById("message-textarea");
    const text = textarea.value.trim();

    if (!text || !currentConversationId) return;

    textarea.value = "";
    autoResizeTextarea(textarea);

    try {
        const { data, error } = await supabaseClient
            .from("messages")
            .insert([{
                conversation_id: currentConversationId,
                sender_id: currentUser.id,
                content: text,
                message_type: "text",
                read: false
            }])
            .select()
            .single();

        if (error) throw error;

        renderMessage(data);
        scrollToBottom();
        stopTyping();
    } catch (err) {
        console.error("Failed to send message:", err);
        showToast("Failed to send message.");
    }
}

function sendQuickReply(text) {
    document.getElementById("message-textarea").value = text;
    sendMessage();
}

async function handleImageUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file size (< 5MB) & type
    if (file.size > 5 * 1024 * 1024) {
        showToast("Image size must be under 5MB.");
        return;
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
        showToast("Invalid file format. Use JPG, PNG, WEBP or GIF.");
        return;
    }

    showToast("Uploading image...");

    try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(2)}.${fileExt}`;
        const filePath = `chat_uploads/${fileName}`;

        const { error: uploadErr } = await supabaseClient.storage
            .from("chat-media")
            .upload(filePath, file);

        if (uploadErr) throw uploadErr;

        const { data: { publicUrl } } = supabaseClient.storage
            .from("chat-media")
            .getPublicUrl(filePath);

        // Insert message with image URL
        const { data, error } = await supabaseClient
            .from("messages")
            .insert([{
                conversation_id: currentConversationId,
                sender_id: currentUser.id,
                content: publicUrl,
                message_type: "image",
                read: false
            }])
            .select()
            .single();

        if (error) throw error;

        renderMessage(data);
        scrollToBottom();
        appendSharedMediaThumb(publicUrl);
        showToast("Image uploaded successfully!");

    } catch (err) {
        console.error("Image upload failed:", err);
        showToast("Image upload failed. Ensure 'chat-media' storage bucket exists.");
    }
}

// ==========================================
// REALTIME SUBSCRIPTIONS & PRESENCE
// ==========================================
function setupRealtimeSubscriptions() {
    if (!currentConversationId) return;

    realtimeChannel = supabaseClient.channel(`room:${currentConversationId}`)
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${currentConversationId}` },
            (payload) => {
                const newMsg = payload.new;
                if (newMsg.sender_id !== currentUser.id) {
                    renderMessage(newMsg);
                    scrollToBottom();
                    markMessagesAsRead();
                    playNotificationSound();
                }
            }
        )
        .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${currentConversationId}` },
            (payload) => {
                const updated = payload.new;
                if (updated.read) {
                    // Update read receipt icon in DOM if sent by me
                    const row = document.querySelector(`.message-row[data-id="${updated.id}"]`);
                    if (row && row.classList.contains('sent')) {
                        const readStatus = row.querySelector('.read-status');
                        if (readStatus) readStatus.textContent = ' ✓✓';
                    }
                }
            }
        )
        .on('broadcast', { event: 'typing' }, (payload) => {
            if (payload.payload.userId !== currentUser.id) {
                showTypingIndicator(payload.payload.isTyping);
            }
        })
        .subscribe();
}

function setupPresence() {
    presenceChannel = supabaseClient.channel('online-users');

    presenceChannel
        .on('presence', { event: 'sync' }, () => {
            const state = presenceChannel.presenceState();
            let isPeerOnline = false;
            for (const key in state) {
                state[key].forEach(presence => {
                    if (peerUser && presence.userId === peerUser.id) {
                        isPeerOnline = true;
                    }
                });
            }
            updateOnlineStatusUI(isPeerOnline);
        })
        .subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                await presenceChannel.track({ userId: currentUser.id, online_at: new Date().toISOString() });
            }
        });
}

function updateOnlineStatusUI(isOnline) {
    const dotSidebar = document.getElementById("peer-status-dot");
    const dotHeader = document.getElementById("peer-status-dot-header");
    const statusText = document.getElementById("peer-status-text");
    const detailsStatus = document.getElementById("details-status");

    if (isOnline) {
        dotSidebar.className = "status-indicator online";
        dotHeader.className = "status-indicator online";
        statusText.textContent = "Active now";
        detailsStatus.textContent = "Online";
    } else {
        dotSidebar.className = "status-indicator offline";
        dotHeader.className = "status-indicator offline";
        statusText.textContent = "Offline";
        detailsStatus.textContent = "Offline";
    }
}

// Typing broadcast
function handleTypingEvent() {
    const textarea = document.getElementById("message-textarea");
    autoResizeTextarea(textarea);

    if (!isTypingSent) {
        isTypingSent = true;
        sendTypingBroadcast(true);
    }

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        isTypingSent = false;
        sendTypingBroadcast(false);
    }, 2000);
}

function stopTyping() {
    clearTimeout(typingTimeout);
    isTypingSent = false;
    sendTypingBroadcast(false);
}

function sendTypingBroadcast(isTyping) {
    if (realtimeChannel) {
        realtimeChannel.send({
            type: 'broadcast',
            event: 'typing',
            payload: { userId: currentUser.id, isTyping }
        });
    }
}

function showTypingIndicator(isTyping) {
    const indicator = document.getElementById("typing-indicator");
    const typingText = document.getElementById("typing-text");
    if (isTyping) {
        typingText.textContent = `${peerUser ? peerUser.username : 'User'} is typing...`;
        indicator.classList.remove("hidden");
        scrollToBottom();
    } else {
        indicator.classList.add("hidden");
    }
}

async function markMessagesAsRead() {
    if (!currentConversationId || !currentUser) return;
    await supabaseClient
        .from("messages")
        .update({ read: true })
        .eq("conversation_id", currentConversationId)
        .neq("sender_id", currentUser.id)
        .eq("read", false);
}

// ==========================================
// UI HELPERS & FEATURES
// ==========================================
function updateSidebarPreview(msg) {
    const preview = document.getElementById("conv-last-msg");
    const timeEl = document.getElementById("conv-time");
    
    preview.textContent = msg.message_type === "image" ? "📷 Sent an image" : msg.content;
    timeEl.textContent = new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom() {
    const container = document.getElementById("messages-container");
    container.scrollTop = container.scrollHeight;
}

function handleKeyInput(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function autoResizeTextarea(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function setupTextareaAutoResize() {
    const textarea = document.getElementById("message-textarea");
    if (textarea) {
        textarea.addEventListener('input', () => autoResizeTextarea(textarea));
    }
}

// Emoji Picker
function initEmojiPicker() {
    const grid = document.getElementById("emoji-grid");
    EMOJI_LIST.forEach(emoji => {
        const span = document.createElement("span");
        span.className = "emoji-item";
        span.textContent = emoji;
        span.onclick = () => {
            const textarea = document.getElementById("message-textarea");
            textarea.value += emoji;
            textarea.focus();
            toggleEmojiPicker();
        };
        grid.appendChild(span);
    });
}

function toggleEmojiPicker(event) {
    if (event) event.stopPropagation();
    const popup = document.getElementById("emoji-picker-popup");
    popup.classList.toggle("hidden");
}

document.addEventListener("click", (e) => {
    const popup = document.getElementById("emoji-picker-popup");
    const btn = document.getElementById("emoji-picker-btn");
    if (popup && !popup.contains(e.target) && btn && !btn.contains(e.target)) {
        popup.classList.add("hidden");
    }
});

// Image Lightbox
function openLightbox(url) {
    document.getElementById("lightbox-img").src = url;
    document.getElementById("image-lightbox").classList.remove("hidden");
}

function closeLightbox() {
    document.getElementById("image-lightbox").classList.add("hidden");
}

// Search in conversation messages
function handleMessageSearch(query) {
    const rows = document.querySelectorAll(".message-row");
    const q = query.toLowerCase();
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        if (!q || text.includes(q)) {
            row.style.display = "flex";
        } else {
            row.style.display = "none";
        }
    });
}

function toggleSearchPanel() {
    const bar = document.getElementById("chat-search-bar");
    bar.classList.toggle("hidden");
    if (!bar.classList.contains("hidden")) {
        document.getElementById("chat-search-input").focus();
    } else {
        handleMessageSearch("");
    }
}

function toggleDetailsPanel() {
    const panel = document.getElementById("details-panel");
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) {
        loadSharedMediaThumbnails();
    }
}

async function loadSharedMediaThumbnails() {
    const grid = document.getElementById("shared-media-grid");
    grid.innerHTML = "";
    try {
        const { data, error } = await supabaseClient
            .from("messages")
            .select("content")
            .eq("conversation_id", currentConversationId)
            .eq("message_type", "image")
            .order("created_at", { ascending: false });

        if (!error && data) {
            data.forEach(item => {
                const img = document.createElement("img");
                img.src = item.content;
                img.className = "shared-media-thumb";
                img.onclick = () => openLightbox(item.content);
                grid.appendChild(img);
            });
        }
    } catch (e) {
        console.error("Error loading shared media:", e);
    }
}

function appendSharedMediaThumb(url) {
    const grid = document.getElementById("shared-media-grid");
    if (grid) {
        const img = document.createElement("img");
        img.src = url;
        img.className = "shared-media-thumb";
        img.onclick = () => openLightbox(url);
        grid.prepend(img);
    }
}

// Nickname & Customization
function saveNickname() {
    const nickname = document.getElementById("nickname-input").value.trim();
    if (nickname && peerUser) {
        document.getElementById("peer-name-header").textContent = nickname;
        document.getElementById("peer-name-sidebar").textContent = nickname;
        showToast("Nickname updated locally.");
    }
}

function setAccentColor(colorHex) {
    document.documentElement.style.setProperty('--primary-color', colorHex);
    document.documentElement.style.setProperty('--primary-hover', colorHex);
    showToast("Theme accent updated.");
}

// Settings & Theme
document.getElementById("settings-toggle-btn").addEventListener("click", () => {
    document.getElementById("settings-modal").classList.remove("hidden");
});

function toggleSettingsModal() {
    document.getElementById("settings-modal").classList.add("hidden");
}

function changeTheme(mode) {
    document.documentElement.setAttribute("data-theme", mode);
    localStorage.setItem("duet_theme", mode);
}

function initTheme() {
    const savedTheme = localStorage.getItem("duet_theme") || "light";
    document.documentElement.setAttribute("data-theme", savedTheme);
    const select = document.getElementById("theme-select");
    if (select) select.value = savedTheme;
}

function playNotificationSound() {
    const toggle = document.getElementById("sound-toggle");
    if (toggle && !toggle.checked) return;
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
        gain.gain.setValueAtTime(0.1, ctx.currentTime);
        osc.start();
        osc.stop(ctx.currentTime + 0.15);
    } catch (e) {
        // AudioContext restricted before user interaction
    }
}

function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.remove("hidden");
    setTimeout(() => {
        toast.classList.add("hidden");
    }, 3000);
}

// Mobile responsive navigation
function openChat() {
    if (window.innerWidth <= 768) {
        document.getElementById("sidebar").classList.add("mobile-hidden");
        document.getElementById("chat-area").classList.remove("mobile-hidden");
    }
}

function closeChatMobile() {
    if (window.innerWidth <= 768) {
        document.getElementById("sidebar").classList.remove("mobile-hidden");
        document.getElementById("chat-area").classList.add("mobile-hidden");
    }
}