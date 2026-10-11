# Описание для магазина (русский)

## Название
Xdebug Cookies: Debug, Profile, Trace

## Краткое описание
Включает cookie XDEBUG_SESSION, XDEBUG_PROFILE и XDEBUG_TRACE, чтобы запускать Xdebug на текущем сайте.

## Описание
Пошаговая отладка, профилирование и трассировка PHP через Xdebug в один клик.

Всплывающее окно на панели браузера включает и выключает cookie-триггеры Xdebug для текущего сайта:
• Отладка — XDEBUG_SESSION (значение — IDE key)
• Профиль — XDEBUG_PROFILE
• Трассировка — XDEBUG_TRACE

Возможности:
• Бейдж на иконке показывает включённые режимы (D, P, T)
• Cookie только для текущего хоста или для родительского домена со всеми поддоменами
• Готовые IDE: VS Code (vsc), PhpStorm, NetBeans, Eclipse, MacGDBp или свой IDE key
• Свой IDE key для отдельного сайта (например, для проектов за DBGp-прокси)
• Свои имена и значения cookie (xdebug.trigger_value)
• Горячие клавиши: Alt+Shift+F — профайлер, Alt+Shift+D — отладчик, Alt+Shift+K — окно
• Работает с контейнерами Firefox, приватными окнами и режимом инкогнито Chrome (после того как вы разрешите там расширение в настройках дополнений браузера)
• Интерфейс на английском, русском и казахском

Настройка сервера (Xdebug 3):
xdebug.mode = debug,profile,trace
xdebug.start_with_request = trigger

Расширение не собирает и не передаёт никаких данных. Исходный код: https://github.com/goodprogrammist/XDEBUG_PROFILE

## Категория
Инструменты разработчика (Developer Tools)
