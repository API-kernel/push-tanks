let isChatOpen = false;

// Экспортируем для game.js
export function initChat(socket) {
    const input = document.getElementById('chat-input');

    // Auto-grow
    const autoResize = () => {
        input.style.height = 'auto'; 
        input.style.height = input.scrollHeight + 'px';
    };

    input.addEventListener('input', autoResize);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            if (!e.shiftKey) { // Shift+Enter для новой строки (опционально)
                e.preventDefault(); // Не переносим строку
                const text = input.value.trim();
                if (text) {
                    socket.emit('chat_message', { text });
                    input.value = '';
                    input.style.height = 'auto'; // Сброс высоты
                }
            }
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            const text = input.value.trim();
            if (text) {
                socket.emit('chat_message', { text });
                input.value = '';
            }
        }
    });

    // 3. Прием сообщений
    socket.on('chat_update', (msg) => {
        // msg = { sender: "Nick", text: "Hello", type: "system"|"player", team: 1|2 }
        addMessage(msg);
    });
}

// Добавляем сообщение в DOM
function addMessage(msg) {
    const list = document.getElementById('chat-messages');
    const div = document.createElement('div');
    
    if (msg.type === 'system') {
        div.innerHTML = `<span class="msg-system">${msg.text}</span>`;
    } else {
        const colorClass = (msg.team === 2) ? 'msg-player-2' : 'msg-player-1';
        // Безопасный вывод текста (от XSS)
        const nameSpan = `<span class="${colorClass}">[${msg.sender}]:</span>`;
        const textSpan = document.createElement('span');
        textSpan.className = 'msg-text';
        textSpan.innerText = ' ' + msg.text;
        
        div.innerHTML = nameSpan;
        div.appendChild(textSpan);
    }
    
    list.appendChild(div);
    list.scrollTop = list.scrollHeight;
}

window.toggleChat = () => {
    isChatOpen = !isChatOpen;
    document.getElementById('chat-window').style.display = isChatOpen ? 'flex' : 'none';
    document.getElementById('chat-toggle').style.display = isChatOpen ? 'none' : 'block';
    
    // Автофокус при открытии
    if (isChatOpen) {
        setTimeout(() => document.getElementById('chat-input').focus(), 10);
    }
};

window.toggleChatVis = () => {
    const chat = document.getElementById('chat-container');
    chat.classList.toggle('open');
};