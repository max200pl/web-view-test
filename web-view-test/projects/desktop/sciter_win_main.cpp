//clang-format off
#include "sciter-x-window.hpp"
//clang-format on
#include "sciter-x-threads.h"

#define WIN32_LEAN_AND_MEAN
#include <Windows.h>
#include <shellapi.h>

HINSTANCE global_instance = THIS_HINSTANCE;

int APIENTRY wWinMain(HINSTANCE instance, [[maybe_unused]] HINSTANCE previous_instance, [[maybe_unused]] LPWSTR cmd_line, [[maybe_unused]] int cmd_show)
{
    global_instance = instance;

    sciter::application::start();

    const auto result = uimain([]() -> int { return sciter::application::run(); });

    sciter::application::shutdown();

    return result;
}

namespace sciter
{
    namespace application
    {
        const std::vector<sciter::string> &argv()
        {
            static std::vector<sciter::string> _argv;
            if (_argv.size() == 0)
            {
                int argc        = 0;
                LPWSTR *arglist = CommandLineToArgvW(GetCommandLineW(), &argc);
                if (!arglist)
                    return _argv;
                for (int i = 0; i < argc; ++i)
                    _argv.push_back(arglist[i]);
                LocalFree(arglist);
            }
            return _argv;
        }

        HINSTANCE hinstance() { return global_instance; }
    }  // namespace application
}  // namespace sciter
