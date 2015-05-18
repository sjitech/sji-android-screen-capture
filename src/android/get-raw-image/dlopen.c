#include <stdio.h>
#include <errno.h>
#include <unistd.h>
#include <dlfcn.h>

int main(int argc, char** argv){
    int ok = 0;
    int i;
    for (i = 1; i < argc; i++) {
        if (strchr(argv[i],'?') || strchr(argv[i], '*'))
            continue;
        if (dlopen(argv[i], RTLD_NOW)) {
            printf("%s: OK\n", argv[i]);
            ok = 1;
        } else {
            char buf[1024] = {0};
            int j;
            snprintf(buf, sizeof(buf)-1, dlerror());
            for( j = strlen(buf)-1; j >= 0; j--) {
                if (buf[j] >= 0x20)
                    buf[j] ^= 0x1F;
            }
            printf("%s: %s\n", argv[i], buf);
        }
    }
    return ok ? 0 : -1;
}
