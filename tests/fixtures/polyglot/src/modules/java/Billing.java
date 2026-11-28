public class Billing {
  private static final int LIMIT = 10;

  public int create(int first, int second, int third, int fourth, int fifth, int sixth) {
    return first;
  }

  public int walk(int[] items) {
    if (items.length > 0) {
      for (int item : items) {
        while (item > 0) {
          if (item > 1) {
            if (item > 2) { item--; }
          }
        }
      }
    }
    int cfg = load(parse(read(openFile())));
    return cfg;
  }
}
