#include <stdio.h>
#include <errno.h>
#include <unistd.h>
#include <dlfcn.h>

int main(int argc, char** argv){
    int i;
    for (i = 1; i < argc; i++) {
        if (dlopen(argv[i], RTLD_NOW)) {
            printf("%s\n", argv[i]);
            fprintf(stderr, "dlopen(%s): OK\n", argv[i]);
            break;
        } else {
            fprintf(stderr, "dlopen(%s): errno %d(%s) %s\n", argv[i], errno, strerror(errno), dlerror());
        }
    }
    return 0;
}
