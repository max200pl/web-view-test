#pragma once

#include "sciter-x-window.hpp"
#include "sciter-x.h"
#include <string>

class MainWindow : public sciter::window
{
public:
    MainWindow();

    void show();

private:
    void loadHtml();
    bool handle_key(HELEMENT he, KEY_PARAMS& params) override;
};
