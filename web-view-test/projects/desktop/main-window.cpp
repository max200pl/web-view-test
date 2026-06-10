#include <Windows.h>

#include "main-window.h"

#include "sciter-x-key-codes.h"

MainWindow::MainWindow() : sciter::window(SW_TITLEBAR | SW_RESIZEABLE | SW_CONTROLS | SW_MAIN | SW_ENABLE_DEBUG)
{
}

    void MainWindow::loadHtml()
    {
        load(L"C:/____WORK____/web-view-test 2/Templates/index.html");
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
