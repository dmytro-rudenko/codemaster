const val LIMIT = 10

fun create(first: Int, second: Int, third: Int, fourth: Int, fifth: Int, sixth: Int): Int {
    return first
}

fun walk(items: List<Int>): Int {
    if (items.isNotEmpty()) {
        for (item in items) {
            while (item > 0) {
                if (item > 1) {
                    if (item > 2) { break }
                }
            }
        }
    }
    val cfg = load(parse(read(openFile())))
    return cfg
}
