#include <Windows.h>
#include <string>

#include "main-window.h"

#include "sciter-x-key-codes.h"

MainWindow::MainWindow() : sciter::window(SW_TITLEBAR | SW_RESIZEABLE | SW_CONTROLS | SW_MAIN | SW_ENABLE_DEBUG)
{
}

// Locate Templates/index.html portably: start from the folder of the running .exe and
// walk UP the tree until the file is found. This makes a fresh clone work from ANY
// location and ANY build config (x64\Debug, x64\Release, ...) without a hardcoded path.
// Forward slashes mirror the path format Sciter's loader expects.
static std::wstring locate_index_html()
{
    wchar_t exe[MAX_PATH] = {0};
    GetModuleFileNameW(nullptr, exe, MAX_PATH);

    std::wstring dir(exe);
    size_t slash = dir.find_last_of(L"\\/");
    if (slash != std::wstring::npos)
        dir.resize(slash);

    for (int up = 0; up < 8; ++up)
    {
        std::wstring candidate = dir + L"\\Templates\\index.html";
        if (GetFileAttributesW(candidate.c_str()) != INVALID_FILE_ATTRIBUTES)
        {
            for (auto &c : candidate)
                if (c == L'\\')
                    c = L'/';
            return candidate;
        }
        slash = dir.find_last_of(L"\\/");
        if (slash == std::wstring::npos)
            break;
        dir.resize(slash);
    }
    return std::wstring();
}

    void MainWindow::loadHtml()
    {
        std::wstring path = locate_index_html();
        // Fallback to a CWD-relative path if the walk-up failed (e.g. exe moved out of
        // the repo tree); the inspector console will show a load error if neither exists.
        load(path.empty() ? L"Templates/index.html" : path.c_str());
    }

void MainWindow::show()
{
    loadHtml();
    bind();
    expand();
}

bool MainWindow::handle_key(HELEMENT he, KEY_PARAMS &params)
{
    if (params.cmd == KEY_UP)
    {
        if (params.key_code == KB_F5 && (params.alt_state & CONTROL_KEY_PRESSED))
        {
        }
    }
    return on_key(he, params.target, params.cmd, params.key_code, params.alt_state);
}
