import socket
import json
import numpy as np
import gymnasium as gym
from gymnasium import spaces

class TankEnv(gym.Env):
    def __init__(self, port=4000):
        super(TankEnv, self).__init__()
        
        self.host = '127.0.0.1'
        self.port = port
        self.sock = None
        self.file_obj = None

        # 0: Стоять, 1: Вверх, 2: Вниз, 3: Лево, 4: Право, 5: Огонь
        self.action_space = spaces.Discrete(6)

        # --- ИСПРАВЛЕНИЕ 1: shape=(11, ...) ---
        self.observation_space = spaces.Box(
            low=-1.0, high=1.0, shape=(5, 26, 26), dtype=np.float32
        )

        self._connect()

    def _connect(self):
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.connect((self.host, self.port))
            self.file_obj = self.sock.makefile('rw') 
            # print(f"Connected to Game Server on {self.port}") # Можно закомментить, чтобы не спамило
        except Exception as e:
            # print(f"Connection failed: {e}")
            raise

    def _send_command(self, cmd):
        if not self.sock:
            self._connect()
        
        try:
            self.sock.sendall((cmd + "\n").encode('utf-8'))
            line = self.file_obj.readline()
            if not line:
                raise ConnectionError("Server closed connection")
            return json.loads(line)
        except Exception as e:
            self.sock.close()
            raise

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        data = self._send_command("RESET")
        
        # --- ИСПРАВЛЕНИЕ 2: reshape(11, ...) ---
        obs = np.array(data['observation'], dtype=np.float32).reshape(5, 26, 26)
        
        return obs, {}

    def step(self, action):
        data = self._send_command(f"STEP {action}")
        
        # --- ИСПРАВЛЕНИЕ 3: reshape(11, ...) ---
        obs = np.array(data['observation'], dtype=np.float32).reshape(5, 26, 26)
        
        reward = float(data['reward'])
        terminated = bool(data['done'])
        truncated = False 
        
        return obs, reward, terminated, truncated, {}

    def close(self):
        if self.sock:
            self.sock.close()   