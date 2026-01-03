import os
import time
import subprocess
import atexit
import torch as th
import torch.nn as nn
from stable_baselines3 import PPO
from stable_baselines3.common.callbacks import CheckpointCallback
from stable_baselines3.common.vec_env import SubprocVecEnv
from stable_baselines3.common.torch_layers import BaseFeaturesExtractor
from stable_baselines3.common.utils import set_random_seed
from tank_env import TankEnv
from stable_baselines3.common.monitor import Monitor # <--- ДОБАВИТЬ ИМПОРТ
from stable_baselines3.common.vec_env import SubprocVecEnv, VecFrameStack

# --- КОНФИГУРАЦИЯ --- 
NUM_ENVS = 16  # Сколько игр запустить параллельно? (Ставь по числу физических ядер CPU, например 8-16)
START_PORT = 4000
MODELS_DIR = "models/ppo_tank"
LOAD_MODEL_PATH = "models/ppo_tank/tank_bot_final.zip" 
#LOAD_MODEL_PATH = None
LOG_DIR = "logs"

# Глобальный список процессов Node.js, чтобы убить их при выходе
node_processes = []

def cleanup_node_processes():
    print("\nKilling Node.js processes...")
    for p in node_processes:
        p.terminate()

atexit.register(cleanup_node_processes)

# --- 1. Кастомная сеть (как была) ---
class CustomCNN(BaseFeaturesExtractor):
    def __init__(self, observation_space, features_dim=256):
        super().__init__(observation_space, features_dim)
        n_input_channels = observation_space.shape[0]
        self.cnn = nn.Sequential(
            nn.Conv2d(n_input_channels, 32, kernel_size=3, stride=1, padding=1),
            nn.ReLU(),
            nn.Conv2d(32, 64, kernel_size=3, stride=1, padding=1),
            nn.ReLU(),
            nn.Conv2d(64, 64, kernel_size=3, stride=1, padding=1),
            nn.ReLU(),
            nn.Flatten(),
        )
        with th.no_grad():
            n_flatten = self.cnn(th.as_tensor(observation_space.sample()[None]).float()).shape[1]
        self.linear = nn.Sequential(nn.Linear(n_flatten, features_dim), nn.ReLU())

    def forward(self, observations):
        return self.linear(self.cnn(observations))

# --- 2. Функция создания среды ---
def make_env(rank, seed=0):
    def _init():
        port = START_PORT + rank
        env = TankEnv(port=port)
        env = Monitor(env) 
        env.reset(seed=seed + rank)
        return env
    return _init

def main():
    # 1. Запускаем Node.js серверы
    print(f"Launching {NUM_ENVS} Node.js servers...")
    for i in range(NUM_ENVS):
        port = START_PORT + i
        # Запускаем node ml_server.js <PORT> в фоне
        # shell=True нужно на Windows, чтобы node вызвался корректно
        proc = subprocess.Popen(f"node ml_server.js {port}", shell=True)
        node_processes.append(proc)
    
    # Даем серверам пару секунд на загрузку карты
    print("Waiting for servers to start...")
    time.sleep(5)

    print("Checking CUDA...")
    if th.cuda.is_available():
        print(f"CUDA is available! Device: {th.cuda.get_device_name(0)}")
    else:
        print("WARNING: CUDA not found.")

    if not os.path.exists(MODELS_DIR): os.makedirs(MODELS_DIR)
    if not os.path.exists(LOG_DIR): os.makedirs(LOG_DIR)

    # 2. Создаем Векторизованную Среду
    env = SubprocVecEnv([make_env(i) for i in range(NUM_ENVS)])
    env = VecFrameStack(env, n_stack=2)

    # 3. ЗАГРУЗКА ИЛИ СОЗДАНИЕ
    if LOAD_MODEL_PATH and os.path.exists(LOAD_MODEL_PATH):
        print(f"\n--- RESUMING TRAINING from {LOAD_MODEL_PATH} ---")
        
        # Загружаем веса
        # Важно передать env, чтобы модель подключилась к текущим серверам
        model = PPO.load(LOAD_MODEL_PATH, env=env, device="cuda")
        
        # Если ты хочешь поменять параметры обучения (например, уменьшить learning_rate на поздних этапах),
        # это можно сделать так:
        # model.learning_rate = 0.0001
        
        reset_timesteps = False # Продолжаем графики, а не начинаем с 0
    else:
        print(f"\n--- STARTING FRESH TRAINING ---")
        
        policy_kwargs = dict(
            features_extractor_class=CustomCNN,
            features_extractor_kwargs=dict(features_dim=256),
        )
        
        model = PPO(
            "CnnPolicy", 
            env, 
            verbose=1, 
            tensorboard_log=LOG_DIR,
            device="cuda", 
            policy_kwargs=policy_kwargs,
            learning_rate=0.0002,
            n_steps=1024,
            ent_coef=0.01, 
            gamma=0.99,
            gae_lambda=0.95,
            clip_range=0.2,
            batch_size=2048,
            n_epochs=5,
            max_grad_norm=0.5,
        )
        reset_timesteps = True

    checkpoint_callback = CheckpointCallback(save_freq=1_000_000, save_path=MODELS_DIR, name_prefix="tank_bot")

    print("Starting training loop...")
    try:
        # reset_num_timesteps=False важно, чтобы в TensorBoard график шел дальше (1M -> 2M), 
        # а не сбрасывался в начало.
        model.learn(total_timesteps=25_000_000, callback=checkpoint_callback, reset_num_timesteps=reset_timesteps)
        
        model.save(f"{MODELS_DIR}/tank_bot_final")
        print("Training finished!")
    except KeyboardInterrupt:
        print("Interrupted. Saving...")
        model.save(f"{MODELS_DIR}/tank_bot_interrupted")
        env.close()
        cleanup_node_processes()

if __name__ == "__main__":
    main()