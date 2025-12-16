import os
import pathlib
from typing import Set

def collect_js_files(
    project_path: str,
    output_file: str = "project_context.txt",
    exclude_dirs: Set[str] = None,
    exclude_files: Set[str] = None
) -> None:
    """
    Собирает все JS файлы проекта в один файл с пометками
    
    Args:
        project_path: Путь к корневой директории проекта
        output_file: Имя выходного файла
        exclude_dirs: Множество директорий для исключения
        exclude_files: Множество файлов для исключения
    """
    
    # Стандартные исключения
    if exclude_dirs is None:
        exclude_dirs = {
            "node_modules", ".git", ".vscode", "__pycache__",
            ".venv", ".env", "dist", "build", "coverage",
            ".idea", ".vs", "shared/maps", "tools", "bin", "obj"
        }
    
    if exclude_files is None:
        exclude_files = {
            "package-lock.json", "yarn.lock", ".gitignore", "package.json"
        }
    
    js_files = []
    total_size = 0
    
    # Собираем все JS файлы
    for root, dirs, files in os.walk(project_path):
        # Исключаем ненужные директории
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        
        for file in files:
            if file.lower().endswith(('.js', '.html', '.css')):
                file_path = os.path.join(root, file)
                rel_path = os.path.relpath(file_path, project_path)
                
                # Проверяем, не в исключенной ли директории
                path_parts = rel_path.split(os.sep)
                if not any(exclude_dir in path_parts for exclude_dir in exclude_dirs):
                    # Исключаем определенные файлы
                    if file not in exclude_files:
                        try:
                            file_size = os.path.getsize(file_path)
                            js_files.append((rel_path, file_path, file_size))
                            total_size += file_size
                        except OSError:
                            continue
    
    # Сортируем файлы для удобства
    js_files.sort(key=lambda x: x[0])
    
    # Записываем в выходной файл
    with open(output_file, 'w', encoding='utf-8') as out_f:
        # Заголовок
        out_f.write("=" * 80 + "\n")
        out_f.write("КОНТЕКСТ ПРОЕКТА - СБОРКА JS ФАЙЛОВ\n")
        out_f.write("=" * 80 + "\n\n")
        
        # Статистика
        out_f.write(f"Всего файлов: {len(js_files)}\n")
        out_f.write(f"Общий размер: {total_size / 1024:.2f} KB\n")
        out_f.write(f"Путь к проекту: {project_path}\n")
        out_f.write("-" * 80 + "\n\n")
        
        # Список файлов
        out_f.write("СПИСОК ФАЙЛОВ:\n")
        out_f.write("-" * 40 + "\n")
        for i, (rel_path, _, size) in enumerate(js_files, 1):
            out_f.write(f"{i:3}. {rel_path} ({size} bytes)\n")
        out_f.write("\n" + "=" * 80 + "\n\n")
        
        # Содержимое файлов
        out_f.write("СОДЕРЖИМОЕ ФАЙЛОВ:\n")
        out_f.write("=" * 80 + "\n\n")
        
        for rel_path, file_path, size in js_files:
            out_f.write(f"\n{'=' * 40}\n")
            out_f.write(f"ФАЙЛ: {rel_path}\n")
            out_f.write(f"ПОЛНЫЙ ПУТЬ: {file_path}\n")
            out_f.write(f"РАЗМЕР: {size} bytes\n")
            out_f.write(f"{'=' * 40}\n\n")
            
            try:
                with open(file_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    out_f.write(content)
            except UnicodeDecodeError:
                # Пробуем другую кодировку
                try:
                    with open(file_path, 'r', encoding='cp1251') as f:
                        content = f.read()
                        out_f.write(f"// Внимание: файл в кодировке cp1251\n")
                        out_f.write(content)
                except:
                    out_f.write(f"// Ошибка: не удалось прочитать файл (бинарный или неизвестная кодировка)\n")
            except Exception as e:
                out_f.write(f"// Ошибка при чтении файла: {str(e)}\n")
            
            out_f.write(f"\n// Конец файла: {rel_path}\n")
            out_f.write(f"{'=' * 40}\n\n")
        
        # Футер
        out_f.write("=" * 80 + "\n")
        out_f.write(f"КОНЕЦ ДОКУМЕНТА\n")
        out_f.write(f"Всего файлов: {len(js_files)}\n")
        out_f.write(f"Общий размер: {total_size} bytes\n")
        out_f.write("=" * 80 + "\n")
    
    print(f"✓ Собрано {len(js_files)} JS файлов")
    print(f"✓ Результат сохранен в: {output_file}")
    print(f"✓ Общий размер: {total_size / 1024:.2f} KB")

def interactive_mode():
    """Интерактивный режим с выбором исключений"""
    print("Сборщик JS файлов для LLM контекста")
    print("-" * 40)
    
    # Запрос пути к проекту
    project_path = input("Путь к проекту [по умолчанию текущая директория]: ").strip()
    if not project_path:
        project_path = "."
    
    if not os.path.exists(project_path):
        print(f"✗ Ошибка: путь '{project_path}' не существует")
        return
    
    # Запрос имени выходного файла
    output_file = input("Имя выходного файла [project_context.txt]: ").strip()
    if not output_file:
        output_file = "project_context.txt"
    
    # Дополнительные исключения
    print("\nУкажите дополнительные директории для исключения (через запятую, Enter для пропуска):")
    extra_exclude = input().strip()
    exclude_dirs = None
    
    if extra_exclude:
        extra_dirs = {d.strip() for d in extra_exclude.split(',') if d.strip()}
        # Объединяем со стандартными
        exclude_dirs = {
            "node_modules", ".git", ".vscode", "__pycache__",
            "venv", ".env", "dist", "build", "coverage",
            ".idea", ".vs", "out", "target", "bin", "obj"
        }
        exclude_dirs.update(extra_dirs)
        print(f"Исключаемые директории: {', '.join(sorted(exclude_dirs))}")
    
    # Запуск сбора
    print(f"\nЗапуск сбора файлов из: {project_path}")
    collect_js_files(project_path, output_file, exclude_dirs)

if __name__ == "__main__":
    # Пример использования через функцию
    # collect_js_files("./my-project", "context.txt")
    
    # Или интерактивный режим
    interactive_mode()