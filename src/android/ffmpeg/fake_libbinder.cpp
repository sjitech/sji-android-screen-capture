#include <unistd.h>
#include <sys/types.h>

namespace android {

template <typename T> class sp {
public:
    T* m_ptr;
};

class ProcessState {
    char data[64]; //please adjust this value when you copy this definition to your real source!!!!!!!!!!!!!!!!!!!!!!!!
public:
    static sp<ProcessState> self();
    void startThreadPool();
};

sp<ProcessState> ProcessState::self() {
    sp<ProcessState> p;
    return p;
}

void ProcessState::startThreadPool() {
}

} //end of namespace android