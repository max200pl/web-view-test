#include "Resource.h"
#include <functional>
#include "sciter-x.h"
#include "main-window.h"

int uimain(std::function<int()> run)
{
    SciterSetOption(NULL, SCITER_SET_SCRIPT_RUNTIME_FEATURES, ALLOW_FILE_IO | ALLOW_SOCKET_IO | ALLOW_EVAL | ALLOW_SYSINFO);
    SciterSetOption(NULL, SCITER_SET_PX_AS_DIP, TRUE);
    //SciterSetOption(NULL, SCITER_ENABLE_UIAUTOMATION, TRUE);
    //SciterSetOption(NULL, SCITER_SET_GFX_LAYER, GFX_LAYER_WARP);

    auto main_window = new MainWindow();
    main_window->show();

    auto result = run();

    return result;
}
