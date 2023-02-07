const { WebSocketServer } = require("ws");
const wss = new WebSocketServer({ port: 8080, path: "/api/chatroom",  });
const express = require("express");
const app = express();
const crypto = require("crypto");
const url = require("url");

const usernames = ["tom", "bill", "sam", "lily", "dan", "chris", "coops"];

app.use(express.static("./public"));
app.use(express.json());

function randomInteger(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function guidGenerator() {
    return crypto.randomBytes(16).toString("hex");
}

const chatrooms = {};

setInterval(() => {
    for (const [key, value] of Object.entries(chatrooms)) {
        if (value.expires_at && value.expires_at <= Date.now()) {
            delete chatrooms[key];
        }
    }
}, 30000);

app.post("/api/chatroom/create", (req, res) => {
    const time = req.body.time;
    if (time && (typeof time !== "number" || time < 0 || time > 10000)) return res.status(400).send();

    const id = guidGenerator();

    chatrooms[id] = { expires_at: Date.now() + 180000, messages: [], connected: {}, time };
    res.json({ code: id });
});

wss.on("connection", (ws, request) => {
    const code = url.parse(request.url, true).query.code;
    if (!code || !chatrooms[code]) return ws.close(1000, "The chatroom code is either invalid or does not exist.");
    
    const room = chatrooms[code];
    if (room.expires_at) {
        if (room.expires_at <= Date.now()) {
            ws.close(1000, "The chatroom code is either invalid or does not exist.");
            delete chatrooms[code];
            return;
        }

        room.expires_at = null;

        if (room.time) {
            room.erase_at = Date.now() + (room.time * 1000);
            room.timeout = setTimeout(() => {
                delete chatrooms[code];
                const connectedUsers = Object.keys(room.connected);
                for (let i = 0; i < connectedUsers.length; i++) {
                    room.connected[connectedUsers[i]].close(1000, "Chatroom has been closed.");
                }
            }, room.time * 1000);
        }
    }

    let username;

    while (true) {
        username = usernames[Math.floor(Math.random() * usernames.length)];
        if (room.connected[username]) continue;
        else break;
    }

    room.connected[username] = ws;

    // Send messages and erase time to client.
    ws.send(JSON.stringify({
        o: 1,
        d: {
            messages: room.messages,
            erase_at: room.erase_at
        }
    }));

    const messageObj = {
        author: "system",
        content: `${username} has joined`,
        usernameColour: "#298c38",
        messageColour: "#298c38"
    };

    room.messages.push(messageObj);

    const connectedUsers = Object.keys(room.connected);
    for (let i = 0; i < connectedUsers.length; i++) {
        room.connected[connectedUsers[i]].send(JSON.stringify({
            o: 2,
            d: messageObj
        }));
    }

    ws.on("close", () => {
        delete room.connected[username];
        if (Object.keys(room.connected).length === 0) {
            clearTimeout(room.timeout);
            delete chatrooms[code];
        } else {
            const messageObj = {
                author: "system",
                content: `${username} has left`,
                usernameColour: "#FF2400",
                messageColour: "#FF2400"
            };
    
            room.messages.push(messageObj);
    
            const connectedUsers = Object.keys(room.connected);
            for (let i = 0; i < connectedUsers.length; i++) {
                room.connected[connectedUsers[i]].send(JSON.stringify({
                    o: 2,
                    d: messageObj
                }));
            }
        }
    });

    ws.on("message", event => {
        let data;

        try {
            data = JSON.parse(event.toString());
        } catch(err) {
            ws.close(1000, "Malformed data has been received.");
            return;
        }

        // Message sent.
        if (data.o === 2) {
            const message = data.d;
            if (!message) {
                ws.close(1000, "Invalid data has been received.");
                return;
            }

            const messageObj = {
                author: username,
                content: message.trim(),
                usernameColour: null,
                messageColour: null
            };

            room.messages.push(messageObj);

            const connectedUsers = Object.keys(room.connected);
            for (let i = 0; i < connectedUsers.length; i++) {
                room.connected[connectedUsers[i]].send(JSON.stringify({
                    o: 2,
                    d: messageObj
                }));
            }
        // Erease chatroom.
        } else if (data.o === 3) {
            clearTimeout(room.timeout);
            delete chatrooms[code];
            const connectedUsers = Object.keys(room.connected);
            for (let i = 0; i < connectedUsers.length; i++) {
                room.connected[connectedUsers[i]].close(1000, "Chatroom has been closed.");
            }
        } else {
            ws.close(1000, "Invalid data has been received.");
            return;
        }
        
    });

});

app.listen(3000);